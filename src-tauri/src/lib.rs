mod commands;
mod error;
mod git;
mod models;
mod scanner;
mod watcher;

#[cfg(any(debug_assertions, test))]
use specta_typescript::{BigIntExportBehavior, Typescript};
use tauri_specta::{collect_commands, Builder};
use watcher::WatcherState;

fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::scan_workspace,
            commands::watch_workspace,
            commands::refresh_repo,
            commands::list_branches,
            commands::switch_branch,
            commands::sync_repos,
            commands::get_app_version_info,
            commands::scan_defunct_branches,
            commands::prune_branches,
        ])
        .typ::<models::LogPayload>()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = specta_builder();

    #[cfg(debug_assertions)]
    builder
        .export(
            Typescript::default().bigint(BigIntExportBehavior::Number),
            "../src/bindings.ts",
        )
        .expect("Failed to export TypeScript bindings");

    tauri::Builder::default()
        .manage(WatcherState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(builder.invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_typescript_bindings() {
        specta_builder()
            .export(
                Typescript::default().bigint(BigIntExportBehavior::Number),
                "../src/bindings.ts",
            )
            .expect("Failed to export TypeScript bindings");
    }
}
