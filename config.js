window.APP_CONFIG = {
  url: "https://wpghiqnflhqhtveyygdu.supabase.co",
  // Clave pública (publishable). Es seguro que esté en el código: los permisos los controla la base de datos.
  key: "sb_publishable_qodGqKmc4TPp2kpGPKLCSA_WG1WggQn"
};

// Avisos en el teléfono: carga push.js sin tocar el resto de la app.
(function () {
  var s = document.createElement('script');
  s.src = 'push.js';
  s.defer = true;
  document.head.appendChild(s);
})();
