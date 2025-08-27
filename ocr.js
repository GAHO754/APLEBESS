const auth = firebase.auth();
const db   = firebase.firestore();

/* ====== Diccionario de productos (sinónimos) ====== */
const PRODUCT_LEXICON = {
  "Hamburguesa Clásica": ["hamburguesa","hamb.","burger","hb","hbg","classic","clasica","clásica","sencilla","single"],
  "Hamburguesa Doble":   ["hamburguesa doble","hamb doble","doble","double","dbl"],
  "Combo Hamburguesa":   ["combo","comb","cmb","paquete","meal","menú","menu"],
  "Alitas":              ["alitas","wing","wings","wing's","wingz"],
  "Boneless":            ["boneless","bonless","bonles","bon.","bonles"],
  "Papas a la Francesa": ["papas","francesa","french fries","fries","pap.","paps","papitas","papas a la francesa"],
  "Aros de Cebolla":     ["aros","aros cebolla","anillos","onion rings","rings"],
  "Refresco":            ["refresco","ref","soda","coca","pepsi","sprite","fanta","manzanita","bebida","soft"],
  "Malteada":            ["malteada","shake","malte","maltead"],
  "Limonada":            ["limonada","lim.","limon","lemonade"],
  "Ensalada":            ["ensalada","salad"],
  "Postre":              ["postre","dessert","brownie","pie","helado","nieve","pastel"],
  "Cerveza":             ["cerveza","beer","victoria","corona","tecate","modelo","bohemia"]
};
const POINTS_MAP = {
  "Hamburguesa Clásica": 5, "Hamburguesa Doble": 7, "Combo Hamburguesa": 8,
  "Alitas": 5, "Boneless": 5, "Papas a la Francesa": 3, "Aros de Cebolla": 3,
  "Refresco": 3, "Malteada": 4, "Limonada": 3, "Ensalada": 4, "Postre": 4, "Cerveza": 3
};

/* ====== Helpers ====== */
function normalize(s){
  return String(s||'')
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"") // quita acentos
    .replace(/[^\w%#./ -]/g,' ')                    // deja símbolos útiles
    .replace(/\s+/g,' ')
    .trim();
}

function productosDesdeLineas(lines){
  const out = [];
  const add = (name, qty=1)=>{
    const i = out.findIndex(p=>p.name===name);
    if(i>=0) out[i].qty += qty; else out.push({name, qty});
  };
  for(const raw of lines){
    const l = ` ${raw} `;
    for(const [canon, syns] of Object.entries(PRODUCT_LEXICON)){
      for(const kw of syns){
        if(l.includes(` ${kw} `) || l.includes(`${kw} `) || l.includes(` ${kw}`)){
          // cantidades: "2 hamburguesa", "hamburguesa x2", "alitas 10pz", "2 pzas alitas"
          let qty = 1;
          const pre = l.match(/(?:^|\s)(\d{1,2})\s*(?:pzas?|pz|uds?|u|x)?(?=\s*[a-z])/);
          if(pre) qty = parseInt(pre[1],10);
          const post = l.match(new RegExp(`${kw}[^\\d]{0,3}(\\d{1,2})\\s*(?:pz|pzas?|u|uds?)?`));
          if(post) qty = Math.max(qty, parseInt(post[1],10));
          add(canon, qty);
          break; // no duplicar el mismo sinónimo en la línea
        }
      }
    }
  }
  return out;
}

function parseTicketText(text){
  const clean = normalize(text);
  const lines = clean.split(/\n|(?<=\d)\s{2,}(?=\D)/g).map(s=>s.trim()).filter(Boolean);

  // número
  let numero = null;
  const idRX = [
    /(?:folio|ticket|tkt|orden|transac(?:cion)?|venta|nota)\s*[:#]?\s*([a-z0-9\-]{4,})/i,
    /(?:id|no\.?)\s*[:#]?\s*([a-z0-9\-]{4,})/i
  ];
  for(const rx of idRX){ const m = clean.match(rx); if(m){ numero = m[1].toUpperCase(); break; } }

  // fecha
  let fechaISO = null;
  const fm = clean.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2})/);
  if(fm){
    let d = +fm[1], m = +fm[2], y = +fm[3];
    if (d<=12 && m>12) [d,m] = [m,d];
    fechaISO = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }

  // total (último "TOTAL ..." del texto)
  let total = null;
  const totAll = [...clean.matchAll(/total(?:\s*(?:a\s*pagar|mxn|pago)?)?[^0-9]{0,12}\$?\s*([0-9]{1,4}[.,][0-9]{2})/g)];
  if (totAll.length){
    total = totAll[totAll.length-1][1].replace(',','.');
  } else {
    const nums = [...clean.matchAll(/\$?\s*([0-9]{1,4}[.,][0-9]{2})/g)].map(m=>parseFloat(m[1].replace(',','.')));
    if (nums.length) total = Math.max(...nums).toFixed(2);
  }

  // productos
  const productosDetectados = productosDesdeLineas(lines);

  return { numero, fecha: fechaISO, total, productosDetectados };
}

/* Mejora: escala/contraste para OCR */
async function recognizeImageToText(file){
  const img = await createImageBitmap(file);
  const scale = Math.min(1.7, 1800 / img.height);      // subir hasta ~1800px alto
  const c = Object.assign(document.createElement('canvas'), {
    width:  Math.round(img.width * scale),
    height: Math.round(img.height * scale)
  });
  const ctx = c.getContext('2d');
  ctx.filter = 'grayscale(1) contrast(1.12) brightness(1.05)';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise(res=>c.toBlob(res, 'image/jpeg', 0.95));

  const { data:{ text } } = await Tesseract.recognize(blob, 'spa+eng', {
    logger: m => console.log(m),
    tessedit_pageseg_mode: 6,
    preserve_interword_spaces: '1',
    user_defined_dpi: '300'
  });
  return text;
}

/* ====== FUNCIÓN PRINCIPAL ====== */
async function leerTicket(){
  const input = document.getElementById("ticketImage") || document.getElementById("ticketFile");
  const file  = input?.files?.[0];
  if (!file) return alert("Selecciona una imagen");

  const statusEl = document.getElementById("ocrResult");
  if (statusEl){ statusEl.textContent = "🕐 Escaneando ticket…"; statusEl.classList?.add('loading-dots'); }

  try{
    const text = await recognizeImageToText(file);
    if (statusEl){ statusEl.classList?.remove('loading-dots'); statusEl.textContent = text; }

    const user = auth.currentUser;
    if (!user) return alert("Debes iniciar sesión");

    const { numero, fecha, total, productosDetectados } = parseTicketText(text);

    // Rellena inputs si existen
    const iNum = document.getElementById('inputTicketNumero');
    const iFecha = document.getElementById('inputTicketFecha');
    const iTotal = document.getElementById('inputTicketTotal');
    if (iNum && numero)  iNum.value  = numero;
    if (iFecha && fecha) iFecha.value = fecha;
    if (iTotal && total) iTotal.value = parseFloat(total).toFixed(2);

    // Puntos
    let totalPts = 0;
    const detalle = productosDetectados.map(p=>{
      const pu  = POINTS_MAP[p.name] || 0;
      const sub = pu * p.qty;
      totalPts += sub;
      return { producto: p.name,   cantidad: p.qty, puntos_unitarios: pu, puntos_subtotal: sub };
    });

    // Duplicado por número (si lo hallamos)
    const ticketsRef = db.collection('users').doc(user.uid).collection('tickets');
    if (numero){
      const dup = await ticketsRef.where('numero','==',numero).limit(1).get();
      if (!dup.empty) return alert("❌ Este ticket ya fue escaneado.");
    }

    // Límite 3 al día
    const start = new Date(); start.setHours(0,0,0,0);
    const end   = new Date(); end.setHours(23,59,59,999);
    const daySnap = await ticketsRef
      .where('createdAt','>=',firebase.firestore.Timestamp.fromDate(start))
      .where('createdAt','<=',firebase.firestore.Timestamp.fromDate(end))
      .get();
    if (daySnap.size >= 3) return alert("⚠️ Ya escaneaste 3 tickets hoy.");

    // Fechas
    const fechaDate = fecha ? new Date(`${fecha}T00:00:00`) : new Date();
    const vence     = new Date(fechaDate); vence.setMonth(vence.getMonth()+6);

    // Guarda como lee tu panel
    await ticketsRef.add({
      numero: numero || "SIN-ID",
      fecha: firebase.firestore.Timestamp.fromDate(fechaDate),
      total: total ? parseFloat(total) : 0,
      productos: productosDetectados.map(p => ({ nombre: p.name, cantidad: p.qty })),
      puntos: { total: totalPts, detalle },
      vencePuntos: firebase.firestore.Timestamp.fromDate(vence),
      textoOCR: text,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    alert(`✅ Ticket guardado. Puntos ganados: ${totalPts}`);
  } catch(e){
    console.error(e);
    if (statusEl){ statusEl.classList?.remove('loading-dots'); statusEl.textContent = "❌ Error al leer el ticket."; }
    alert("No pude leer el ticket. Intenta con más luz, sin sombras y lo más recto posible.");
  }
}

/* Si tienes un botón "Procesar ticket", enlázalo aquí */
document.getElementById('btnProcesarTicket')?.addEventListener('click', leerTicket);