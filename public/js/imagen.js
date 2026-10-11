// imagen.js
// Reduce y comprime una foto (a JPEG) antes de mandarla a la IA, para que
// viaje rápido y quepa en el límite de las Edge Functions.
const MAX_LADO = 1280;            // px del lado más largo
const MAX_CARACTERES = 1_800_000; // tamaño máximo del data URL resultante

/**
 * @param {File} archivo foto elegida por la persona (JPG, PNG o WebP)
 * @returns {Promise<string>} data URL JPEG comprimido
 */
export function prepararImagen(archivo) {
  return new Promise((resolver, rechazar) => {
    if (!/^image\/(jpeg|png|webp)$/.test(archivo.type)) {
      rechazar(new Error('Usa una imagen JPG, PNG o WebP.'));
      return;
    }
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const escala = Math.min(1, MAX_LADO / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * escala);
      canvas.height = Math.round(img.height * escala);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      // Bajamos la calidad hasta que quepa en el límite
      for (const calidad of [0.85, 0.7, 0.55, 0.4]) {
        const dataUrl = canvas.toDataURL('image/jpeg', calidad);
        if (dataUrl.length <= MAX_CARACTERES) {
          resolver(dataUrl);
          return;
        }
      }
      rechazar(new Error('La imagen es demasiado grande.'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rechazar(new Error('No se pudo leer la imagen.'));
    };
    img.src = url;
  });
}
