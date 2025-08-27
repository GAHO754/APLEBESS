// Inicializa Firebase Auth
const auth = firebase.auth();

// Espera a que el usuario esté autenticado
auth.onAuthStateChanged(user => {
  if (user) {
    const name = user.displayName || "Cliente";
    const initials = getInitials(name);
    
    // Mostrar nombre e iniciales en la barra superior
    document.getElementById("userName").textContent = name;
    document.getElementById("profileCircle").textContent = initials;
  } else {
    // Si no hay usuario, redirige al login
    window.location.href = "index.html";
  }
});

// Extraer iniciales de nombre
function getInitials(name) {
  return name
    .split(" ")
    .map(part => part[0].toUpperCase())
    .join("")
    .slice(0, 2);
}

// Abrir modal de perfil
function openProfileModal() {
  const user = auth.currentUser;
  if (user) {
    document.getElementById("editName").value = user.displayName || "";
    document.getElementById("editEmail").value = user.email || "";
    // Teléfono opcional: podría usarse con Firestore
  }
  document.getElementById("profileModal").style.display = "block";
}

// Cerrar modal
function closeProfileModal() {
  document.getElementById("profileModal").style.display = "none";
}

// Guardar cambios del perfil
function saveProfileChanges() {
  const user = auth.currentUser;
  const newName = document.getElementById("editName").value.trim();
  const newEmail = document.getElementById("editEmail").value.trim();
  const newPhone = document.getElementById("editPhone").value.trim(); // para Firestore opcional

  const updates = [];

  if (newName) {
    updates.push(user.updateProfile({ displayName: newName }));
  }

  if (newEmail && newEmail !== user.email) {
    updates.push(user.updateEmail(newEmail));
  }

  Promise.all(updates)
    .then(() => {
      alert("✅ Perfil actualizado correctamente");
      closeProfileModal();
      location.reload(); // Refresca el panel para mostrar nuevos datos
    })
    .catch(error => {
      alert("❌ Error: " + error.message);
    });
}

// Función de logout
function logout() {
  auth.signOut().then(() => {
    window.location.href = "index.html";
  });
}

// Generar QR (placeholder funcional)
function generarQR() {
  const container = document.getElementById("qr-container");
  container.innerHTML = "<p>🔧 Aquí iría el QR de recompensa generado.</p>";
}
 // Si usas Firebase
    firebase.auth().onAuthStateChanged(function(user) {
    if (user && user.displayName) {
      document.getElementById("clientName").textContent = user.displayName;
    }
  });

  // O si tienes una variable desde backend:
  // document.getElementById("clientName").textContent = nombreCliente;

  function registrarTicketManual() {
  const numero = document.getElementById('inputTicketNumero').value.trim();
  const fecha = document.getElementById('inputTicketFecha').value;
  const total = document.getElementById('inputTicketTotal').value;
  const validacion = document.getElementById('ticketValidacion');

  const productos = productosSeleccionados; // Aquí se usa el arreglo dinámico

  if (!numero || !fecha || !productos.length || !total) {
    validacion.textContent = "⚠️ Completa todos los campos, incluyendo al menos un producto.";
    validacion.style.color = "red";
    return;
  }

  validacion.textContent = "✅ Ticket registrado correctamente.";
  validacion.style.color = "green";

  const ticketFoto = document.getElementById('ticketFile').files[0] || null;

  // Aquí puedes procesar todo el ticket:
  console.log({
    numero,
    fecha,
    productos, // [{nombre: "...", cantidad: ...}, ...]
    total,
    foto: ticketFoto
  });

  // ¿Quieres que aquí se cree una tarjeta visual con la info capturada?
}



const productosSeleccionados = [];

function agregarProducto() {
  const nombre = document.getElementById('nuevoProducto').value.trim();
  const cantidad = document.getElementById('nuevaCantidad').value;

  if (!nombre || !cantidad || cantidad <= 0) {
    alert("🛑 Ingresa un nombre válido y cantidad mayor a 0.");
    return;
  }

  productosSeleccionados.push({ nombre, cantidad });
  actualizarListaProductos();
  document.getElementById('nuevoProducto').value = "";
  document.getElementById('nuevaCantidad').value = "";
}

function actualizarListaProductos() {
  const lista = document.getElementById('listaProductos');
  lista.innerHTML = "";
  productosSeleccionados.forEach((prod, index) => {
    const item = document.createElement('p');
    item.textContent = `• ${prod.nombre} (x${prod.cantidad})`;
    lista.appendChild(item);
  });
}
