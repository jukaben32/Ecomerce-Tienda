// tailwind.config.js
// Paleta y tipografías de ModaNueva. Tailwind escanea el HTML y TODO el
// JavaScript (las clases que se escriben dentro de plantillas de texto también
// se detectan), y genera solo el CSS que realmente se usa.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./public/**/*.html', './public/js/**/*.js'],
  theme: {
    extend: {
      colors: {
        papel: '#F4EFE6',   // fondo general
        crema: '#EAE2D3',   // superficies
        tinta: '#1C1A17',   // texto y botones
        arcilla: '#B5472B', // acento (ofertas, enlaces)
        salvia: '#5F6F52'   // acento secundario (éxito)
      },
      fontFamily: {
        display: ['Newsreader', 'Georgia', 'serif'],
        sans: ['"DM Sans"', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
};
