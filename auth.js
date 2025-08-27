const auth = firebase.auth();

// INICIAR SESIÓN
function login() {
  const input = document.getElementById("emailOrPhone").value.trim();
  const password = document.getElementById("password").value;

  if (!input || !password) {
    alert("⚠️ Ingresa correo y contraseña");
    return;
  }

  if (input.includes("@")) {
    auth.signInWithEmailAndPassword(input, password)
      .then(() => {
        alert("✅ Bienvenido");
        // Redirige al panel o página principal
        window.location.href = "panel.html";
      })
      .catch(error => alert("❌ " + error.message));
  } else {
    alert("⚠️ El acceso con teléfono requiere integración con SMS. Lo configuramos más adelante.");
  }
}

// REGISTRO DE CUENTA NUEVA
function register() {
  const name = document.getElementById("regName").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const phone = document.getElementById("regPhone").value.trim();
  const password = document.getElementById("regPassword").value;

  if (!email && !phone) {
    alert("❌ Debes ingresar un correo o teléfono.");
    return;
  }

  if (!password) {
    alert("❌ Debes ingresar una contraseña.");
    return;
  }

  if (!name) {
    alert("❌ Debes ingresar tu nombre completo.");
    return;
  }

  if (email) {
    auth.createUserWithEmailAndPassword(email, password)
      .then(userCredential => {
        const user = userCredential.user;
        // Actualiza el perfil con nombre
        return user.updateProfile({
          displayName: name
        });
      })
      .then(() => {
        alert(`✅ ¡Bienvenido, ${name}! Cuenta creada correctamente`);
        window.location.href = "index.html"; // Regresa al login
      })
      .catch(error => alert("❌ " + error.message));
  } else {
    alert("⚠️ Registro con teléfono requiere verificación SMS y reCAPTCHA. Podemos añadirlo después.");
  }
}


// RESTABLECER CONTRASEÑA
function resetPassword() {
  const email = prompt("📧 Ingresa tu correo para restablecer la contraseña:");
  if (email) {
    auth.sendPasswordResetEmail(email)
      .then(() => alert("✅ Correo de recuperación enviado"))
      .catch(error => alert("❌ " + error.message));
  }
}
