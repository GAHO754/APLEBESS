// registrar.js — Cámara + OCR + Puntos + Firestore (limpio)
(() => {
  const $ = id => document.getElementById(id);

  // ===== Firebase =====
  const db = firebase.firestore();
  db.enablePersistence({ synchronizeTabs: true }).catch(()=>{});
  console.log("Proyecto (registrar):", firebase.app().options.projectId);

  // ===== UI =====
  const fileInput    = $('ticketFile');
  const dropzone     = $('dropzone');
  const btnCam       = $('btnAbrirCamara');

  const modal        = $('cameraModal');
  const btnClose     = $('btnCerrarCamara');
  const video        = $('cameraVideo');
  const btnShot      = $('btnCapturar');

  const btnOCR       = $('btnProcesarTicket');
  const btnEditar    = $('btnEditarManual');
  const ocrStatus    = $('ocrStatus');

  const iNum         = $('inputTicketNumero');
  const iFecha       = $('inputTicketFecha');
  const iTotal       = $('inputTicketTotal');

  const listaProd    = $('listaProductos');
  const nuevoProd    = $('nuevoProducto');
  const nuevaCant    = $('nuevaCantidad');
  const btnAdd       = $('btnAgregarProducto');

  const buscarProd   = $('buscarProducto');
  const gridProd     = $('productosGrid');

  const btnRegistrar = $('btnRegistrarTicket');
  const msgTicket    = $('ticketValidacion');

  const tablaPuntosBody = ($('tablaPuntos')||{}).querySelector?.('tbody');
  const totalPuntosEl   = $('totalPuntos');

  // ===== Estado =====
  let liveStream = null;
  let currentPreviewURL = null;
  let productos = []; // [{name, qty}]
  let ocrWorker = null;

  // ===== Catálogo / Puntos =====
  const CATALOGO = [
    "Hamburguesa Clásica","Hamburguesa Doble","Combo Hamburguesa",
    "Alitas","Boneless","Papas a la Francesa","Aros de Cebolla",
    "Refresco","Malteada","Limonada","Ensalada","Postre","Cerveza"
  ];
  const PUNTOS_MAP = Object.freeze({
    "Hamburguesa Clásica": 5, "Hamburguesa Doble": 7, "Combo Hamburguesa": 8,
    "Alitas": 5, "Boneless": 5, "Papas a la Francesa": 3, "Aros de Cebolla": 3,
    "Refresco": 3, "Malteada": 4, "Limonada": 3, "Ensalada": 4, "Postre": 4, "Cerveza": 3
  });
  const getPuntosUnit = (name) => Number(PUNTOS_MAP[name] || 0);

  // ===== Util =====
  function setStatus(msg, type='') {
    if (!ocrStatus) return;
    ocrStatus.className = 'validacion-msg';
    if (type) ocrStatus.classList.add(type); // ok | err
    ocrStatus.textContent = msg || '';
  }
  function enableForm(on) {
    [iNum, iFecha, iTotal, nuevoProd, nuevaCant, btnAdd, buscarProd, btnRegistrar]
      .forEach(x => x && (x.disabled = !on));
  }
  function setPreview(file) {
    if (currentPreviewURL) URL.revokeObjectURL(currentPreviewURL);
    const url = URL.createObjectURL(file);
    currentPreviewURL = url;
    dropzone?.querySelectorAll('img.preview').forEach(n => n.remove());
    if (dropzone) {
      const img = document.createElement('img');
      img.className = 'preview';
      img.alt = 'Vista previa ticket';
      img.src = url;
      dropzone.appendChild(img);
    }
  }
  function dataURLtoBlob(dataURL) {
    const [meta, b64] = dataURL.split(',');
    const mime = meta.split(':')[1].split(';')[0];
    const bin = atob(b64);
    const ab = new ArrayBuffer(bin.length);
    const ia = new Uint8Array(ab);
    for (let i=0;i<bin.length;i++) ia[i] = bin.charCodeAt(i);
    return new Blob([ab], { type: mime });
  }
  function setFileInputFromBlob(blob, name='ticket.jpg') {
    const file = new File([blob], name, { type: blob.type||'image/jpeg', lastModified: Date.now() });
    const dt = new DataTransfer();
    dt.items.add(file);
    if (fileInput) fileInput.files = dt.files;
    setPreview(file);
  }

  // ===== Productos =====
  function upsertProducto(nombre, cantidad=1) {
    nombre = String(nombre||'').trim();
    if (!nombre) return;
    const idx = productos.findIndex(p => p.name.toLowerCase() === nombre.toLowerCase());
    if (idx >= 0) productos[idx].qty += cantidad;
    else productos.push({ name: nombre, qty: cantidad });
    renderProductos();
  }
  function renderProductos() {
    if (!listaProd) return;
    listaProd.innerHTML = '';
    productos.forEach(p => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.innerHTML = `
        <span>${p.name}</span>
        <span class="qty">
          <button type="button" data-act="-" data-name="${p.name}">−</button>
          <strong>${p.qty}</strong>
          <button type="button" data-act="+" data-name="${p.name}">+</button>
        </span>
        <button type="button" data-act="x" data-name="${p.name}">✕</button>
      `;
      listaProd.appendChild(chip);
    });
    updatePuntosResumen();
  }
  function renderCatalogo(filtro='') {
    const f = filtro.trim().toLowerCase();
    if (!gridProd) return;
    gridProd.innerHTML = '';
    CATALOGO.filter(n=>n.toLowerCase().includes(f)).forEach(n=>{
      const card = document.createElement('div');
      card.className = 'card-prod';
      card.innerHTML = `<span class="prod-name">${n}</span><button type="button" class="btn-primary" data-add="${n}">Agregar</button>`;
      gridProd.appendChild(card);
    });
  }

  // ===== Puntos =====
  function updatePuntosResumen() {
    if (!tablaPuntosBody) return;
    tablaPuntosBody.innerHTML = '';
    let total = 0;
    productos.forEach(p=>{
      const u = getPuntosUnit(p.name);
      const sub = u * p.qty;
      total += sub;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${p.name}</td><td>${p.qty}</td><td>${u}</td><td>${sub}</td>`;
      tablaPuntosBody.appendChild(tr);
    });
    if (totalPuntosEl) totalPuntosEl.textContent = String(total);
  }
  function getPuntosDetalle() {
    let total = 0;
    const detalle = productos.map(p=>{
      const u = getPuntosUnit(p.name);
      const sub = u * p.qty;
      total += sub;
      return { producto: p.name, cantidad: p.qty, puntos_unitarios: u, puntos_subtotal: sub };
    });
    return { total, detalle };
  }

  // ===== Cámara =====
  async function openCamera() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("Tu navegador no soporta cámara. Usa Adjuntar foto.", "err");
        return;
      }
      video.muted = true;
      video.setAttribute('playsinline','true');

      const tries = [
        { video: { facingMode: { exact: "environment" }, width:{ideal:1920}, height:{ideal:1080} }, audio:false },
        { video: { facingMode: { ideal: "environment" },  width:{ideal:1920}, height:{ideal:1080} }, audio:false },
        { video: true, audio:false }
      ];
      let stream = null, lastErr = null;
      for (const c of tries) {
        try { stream = await navigator.mediaDevices.getUserMedia(c); break; }
        catch(e){ lastErr = e; }
      }
      if (!stream) throw lastErr || new Error("No se pudo abrir la cámara");

      liveStream = stream;
      video.srcObject = stream;
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden','false');
      await video.play();
      setStatus('');
    } catch (e) {
      console.error("getUserMedia:", e);
      let msg = "No se pudo acceder a la cámara. Revisa permisos del navegador.";
      if ((!window.isSecureContext && location.hostname !== 'localhost') ||
          (location.protocol !== 'https:' && location.hostname !== 'localhost')) {
        msg += " (En móviles debes abrir el sitio con HTTPS).";
      }
      setStatus(msg, "err");
      fileInput?.click(); // Fallback
    }
  }
  function stopCamera() {
    if (liveStream) { liveStream.getTracks().forEach(t=>t.stop()); liveStream = null; }
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden','true');
  }
  async function captureFrame() {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) { setStatus("Cámara aún no lista. Intenta de nuevo.", "err"); return; }

    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(video, 0, 0, w, h);

    stopCamera();

    // OpenCV opcional (si está cargado)
    let dataURL;
    if (window.cv && window.cv.Mat) {
      try { dataURL = processWithOpenCV(c); }
      catch(e){ console.warn("OpenCV falló:", e); dataURL = c.toDataURL("image/jpeg", .95); }
    } else {
      dataURL = c.toDataURL("image/jpeg", .95);
    }
    const blob = dataURLtoBlob(dataURL);
    setFileInputFromBlob(blob, `ticket_${Date.now()}.jpg`);

    enableForm(true);
    setStatus("Foto capturada. Procesando OCR…", "ok");
    // Ejecuta OCR automáticamente
    procesarTicket();
  }
  function processWithOpenCV(canvasEl) {
    const cv = window.cv;
    let src = cv.imread(canvasEl);
    let dst = new cv.Mat();
    let gray = new cv.Mat();
    let blurred = new cv.Mat();
    let canny = new cv.Mat();
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    let best = null;

    try {
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
      cv.GaussianBlur(gray, blurred, new cv.Size(5,5), 0,0, cv.BORDER_DEFAULT);
      cv.Canny(blurred, canny, 75, 200, 3, false);
      cv.findContours(canny, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      let maxArea = 0;
      for (let i=0;i<contours.size();i++){
        const cont = contours.get(i);
        const area = cv.contourArea(cont);
        if (area < 15000) continue;
        const peri = cv.arcLength(cont, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(cont, approx, .02*peri, true);
        if (approx.rows === 4 && area > maxArea) { if (best) best.delete(); best = approx; maxArea = area; } else { approx.delete(); }
      }

      let outCanvas = document.createElement('canvas');
      if (best) {
        const pts = [];
        for (let i=0;i<best.rows;i++) pts.push({x: best.data32S[i*2], y: best.data32S[i*2+1]});
        const [tl,tr,br,bl] = orderQuad(pts);
        const wA = Math.hypot(br.x-bl.x, br.y-bl.y);
        const wB = Math.hypot(tr.x-tl.x, tr.y-tl.y);
        const hA = Math.hypot(tr.x-br.x, tr.y-br.y);
        const hB = Math.hypot(tl.x-bl.x, tl.y-bl.y);
        const W = Math.max(wA,wB), H = Math.max(hA,hB);

        const dSize = new cv.Size(Math.max(300, Math.floor(W)), Math.max(400, Math.floor(H)));
        const srcPts = cv.matFromArray(4,1,cv.CV_32FC2,[tl.x,tl.y, tr.x,tr.y, br.x,br.y, bl.x,bl.y]);
        const dstPts = cv.matFromArray(4,1,cv.CV_32FC2,[0,0, dSize.width-1,0, dSize.width-1,dSize.height-1, 0,dSize.height-1]);
        const M = cv.getPerspectiveTransform(srcPts, dstPts);
        cv.warpPerspective(src, dst, M, dSize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
        srcPts.delete(); dstPts.delete(); M.delete(); best.delete();

        const out = document.createElement('canvas');
        cv.imshow(out, dst);
        const ctx = out.getContext('2d');
        ctx.filter = 'contrast(1.18) brightness(1.06) grayscale(1)';
        const tmp = document.createElement('canvas'); tmp.width = out.width; tmp.height = out.height;
        tmp.getContext('2d').drawImage(out,0,0); ctx.drawImage(tmp,0,0);
        outCanvas = out;
      } else {
        outCanvas = canvasEl;
      }
      return outCanvas.toDataURL("image/jpeg", .95);
    } finally {
      src.delete(); dst.delete(); gray.delete(); blurred.delete();
      canny.delete(); contours.delete(); hierarchy.delete(); if (best) best.delete();
    }

    function orderQuad(pts){
      const rect = new Array(4);
      const s = pts.map(p=>p.x+p.y);
      const d = pts.map(p=>p.y-p.x);
      rect[0] = pts[s.indexOf(Math.min(...s))]; // tl
      rect[2] = pts[s.indexOf(Math.max(...s))]; // br
      rect[1] = pts[d.indexOf(Math.min(...d))]; // tr
      rect[3] = pts[d.indexOf(Math.max(...d))]; // bl
      return rect;
    }
  }

  // ===== OCR =====
  // Léxico y parsing mejorados
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
  function normalize(s){
    return String(s||'')
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .replace(/[^\w%#./ -]/g,' ')
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
            let qty = 1;
            const pre = l.match(/(?:^|\s)(\d{1,2})\s*(?:pzas?|pz|uds?|u|x)?(?=\s*[a-z])/);
            if(pre) qty = parseInt(pre[1],10);
            const post = l.match(new RegExp(`${kw}[^\\d]{0,3}(\\d{1,2})\\s*(?:pz|pzas?|u|uds?)?`));
            if(post) qty = Math.max(qty, parseInt(post[1],10));
            add(canon, qty);
            break;
          }
        }
      }
    }
    return out;
  }

  async function ensureWorker() {
    if (ocrWorker) return ocrWorker;
    const { createWorker } = Tesseract;
    ocrWorker = await createWorker({
      langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
      logger: m => {
        if (m.status === 'recognizing text' && m.progress != null) {
          setStatus(`Reconociendo texto… ${Math.round(m.progress*100)}%`);
        }
      }
    });
    await ocrWorker.loadLanguage('spa+eng');
    await ocrWorker.initialize('spa+eng');
    await ocrWorker.setParameters({
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
      user_defined_dpi: '300'
    });
    return ocrWorker;
  }
  function parseOCR(text) {
    const clean = normalize(text);
    const lines = clean.split(/\n|(?<=\d)\s{2,}(?=\D)/g).map(s=>s.trim()).filter(Boolean);

    // Número
    let numero = null;
    const idRX = [
      /(?:folio|ticket|tkt|orden|transac(?:cion)?|venta|nota)\s*[:#]?\s*([a-z0-9\-]{4,})/i,
      /(?:id|no\.?)\s*[:#]?\s*([a-z0-9\-]{4,})/i
    ];
    for(const rx of idRX){ const m = clean.match(rx); if(m){ numero = m[1].toUpperCase(); break; } }

    // Fecha
    let fecha = null;
    const f = clean.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2})/);
    if (f) {
      let d = parseInt(f[1],10), m = parseInt(f[2],10), y = parseInt(f[3],10);
      if (d<=12 && m>12) [d,m] = [m,d];
      fecha = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }

    // Total
    let total = null;
    const totals = [...clean.matchAll(/total(?:\s*(?:a\s*pagar|mxn|pago)?)?[^0-9]{0,12}\$?\s*([0-9]{1,4}[.,][0-9]{2})/g)];
    if (totals.length) total = totals[totals.length-1][1].replace(',','.');
    else {
      const nums = [...clean.matchAll(/\$?\s*([0-9]{1,4}[.,][0-9]{2})/g)].map(m=>parseFloat(m[1].replace(',','.')));
      if (nums.length) total = Math.max(...nums).toFixed(2);
    }

    // Productos
    const productosDetectados = productosDesdeLineas(lines);

    return { numero, fecha, total, productosDetectados };
  }
  async function procesarTicket() {
    const file = fileInput?.files?.[0];
    if (!file) { setStatus("Primero adjunta o toma la foto del ticket.", "err"); return; }

    setStatus("Reconociendo texto… 0%");
    enableForm(false);
    msgTicket && (msgTicket.textContent = '');

    try {
      const worker = await ensureWorker();
      const OCR_TIMEOUT_MS = 25000;
      const ocrPromise = worker.recognize(file).then(r=>r.data);
      const timeout = new Promise((_,rej)=>setTimeout(()=>rej(new Error('OCR_TIMEOUT')), OCR_TIMEOUT_MS));
      const data = await Promise.race([ocrPromise, timeout]);

      const { numero, fecha, total, productosDetectados } = parseOCR(data.text || '');

      if (numero) iNum && (iNum.value = numero);
      if (fecha)  iFecha && (iFecha.value = fecha);
      if (total)  iTotal && (iTotal.value = parseFloat(total).toFixed(2));

      productos = [];
      productosDetectados.forEach(p => upsertProducto(p.name, p.qty));

      setStatus("✓ Ticket procesado. Verifica/ajusta los campos.", "ok");
    } catch (e) {
      console.warn("OCR error:", e);
      setStatus(String(e?.message).includes('OCR_TIMEOUT')
        ? "OCR tardó demasiado. Edición manual habilitada."
        : "No pude leer el ticket. Prueba con más luz o edita manualmente.", "err");
    } finally {
      enableForm(true);
    }
  }

  // ===== Guardar en Firestore =====
  function addMonths(date, months){ const d=new Date(date.getTime()); d.setMonth(d.getMonth()+months); return d; }

  async function registrarTicket() {
    const user = firebase.auth().currentUser;
    if (!user) {
      msgTicket.className='validacion-msg err';
      msgTicket.textContent = "Debes iniciar sesión para registrar.";
      return;
    }

    const numero = iNum.value.trim();
    const fechaStr = iFecha.value;
    const totalNum = parseFloat(iTotal.value || "0") || 0;

    if (!numero || !fechaStr || !totalNum) {
      msgTicket.className='validacion-msg err';
      msgTicket.textContent = "Faltan datos obligatorios: número, fecha y total.";
      return;
    }

    const puntos = getPuntosDetalle();
    const fecha = new Date(`${fechaStr}T00:00:00`);
    const vencePuntos = addMonths(fecha, 6);

    const docData = {
      numero,
      fecha: firebase.firestore.Timestamp.fromDate(fecha),
      total: totalNum,
      productos: productos.map(p=>({nombre:p.name, cantidad:p.qty})),
      puntos, // { total, detalle[] }
      vencePuntos: firebase.firestore.Timestamp.fromDate(vencePuntos),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
      await db.collection('users').doc(user.uid).collection('tickets').add(docData);
      msgTicket.className='validacion-msg ok';
      msgTicket.textContent = `✅ Ticket registrado. Puntos: ${puntos.total}`;
      setTimeout(()=>{ window.location.href = 'panel.html'; }, 1200);
    } catch (e) {
      console.error(e);
      msgTicket.className='validacion-msg err';
      msgTicket.textContent = "Error al guardar el ticket. Revisa reglas de Firestore o inténtalo de nuevo.";
    }
  }

  // ===== Eventos =====
  btnCam?.addEventListener('click', openCamera);
  btnClose?.addEventListener('click', stopCamera);
  btnShot?.addEventListener('click', captureFrame);

  fileInput?.addEventListener('change', (e)=>{
    const f = e.target.files && e.target.files[0];
    if (f) { setPreview(f); enableForm(true); setStatus("Imagen cargada. Puedes editar o usar OCR.", "ok"); }
  });

  btnOCR?.addEventListener('click', procesarTicket);
  btnEditar?.addEventListener('click', ()=>{ enableForm(true); setStatus("Edición manual habilitada.", "ok"); });

  listaProd?.addEventListener('click', (e)=>{
    const btn = e.target.closest('button');
    if (!btn) return;
    const act = btn.dataset.act, name = btn.dataset.name;
    const idx = productos.findIndex(p=>p.name===name);
    if (idx<0) return;
    if (act==='+') productos[idx].qty++;
    if (act==='-' && productos[idx].qty>1) productos[idx].qty--;
    if (act==='x') productos.splice(idx,1);
    renderProductos();
  });

  btnAdd?.addEventListener('click', ()=>{
    const n = nuevoProd.value.trim();
    const c = Math.max(1, parseInt(nuevaCant.value||"1", 10));
    if (n) upsertProducto(n, c);
    nuevoProd.value=''; nuevaCant.value='';
  });

  buscarProd?.addEventListener('input', e=>renderCatalogo(e.target.value));
  gridProd?.addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-add]');
    if (!btn) return;
    upsertProducto(btn.dataset.add, 1);
  });

  btnRegistrar?.addEventListener('click', registrarTicket);

  // ===== Init =====
  enableForm(false);           // deshabilitado hasta foto/OCR o pulsar "Editar manualmente"
  renderCatalogo('');
  updatePuntosResumen();

  if ((!window.isSecureContext && location.hostname !== 'localhost') ||
      (location.protocol !== 'https:' && location.hostname !== 'localhost')) {
    setStatus("Para usar la cámara en móviles, abre el sitio con HTTPS.", "err");
  }
})();
