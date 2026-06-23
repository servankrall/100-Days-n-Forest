import { defineConfig } from "vite";

// Web varlıklarını Capacitor (Android) için tek, kendi kendine yeten pakete derler.
// 'three' bare import'u bu derlemede paketin içine gömülür (Android WebView importmap+node_modules kullanamaz).
// Masaüstü (Electron) index.html'deki importmap'i kullanır; mobil derlemede ona gerek yok, bu yüzden çıkarılır.
const stripImportmap = {
  name: "strip-importmap",
  transformIndexHtml(html) {
    return html.replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, "");
  }
};

export default defineConfig({
  base: "./",                 // Capacitor WebView'da göreli yollar şart
  plugins: [stripImportmap],
  build: {
    outDir: "www",            // capacitor.config.json -> webDir
    emptyOutDir: true,
    target: "es2019",
    chunkSizeWarningLimit: 1500
  }
});
