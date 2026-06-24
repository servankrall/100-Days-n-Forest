// 100 Gün Ormanda — Tauri masaüstü sarmalayıcı (sistem WebView2'sini kullanır, küçük .exe)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Tauri uygulaması çalıştırılırken hata");
}
