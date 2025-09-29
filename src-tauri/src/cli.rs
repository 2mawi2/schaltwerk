use clap::CommandFactory;

pub use schaltwerk::shared::cli::{detect_special_cli_action, Cli, SpecialCliAction, VERSION};

pub fn perform_special_cli_action(action: SpecialCliAction) {
    match action {
        SpecialCliAction::ShowHelp => {
            let mut command = Cli::command();
            let help = command.render_help().to_string();
            print!("{help}");
            if !help.ends_with('\n') {
                println!();
            }
        }
        SpecialCliAction::ShowVersion => {
            println!("schaltwerk {VERSION}");
        }
    }
}
