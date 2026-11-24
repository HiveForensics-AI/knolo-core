use schemars::JsonSchema;
use serde::Deserialize;
use zed::settings::ContextServerSettings;
use zed_extension_api::{
    self as zed, serde_json, Command, ContextServerConfiguration, ContextServerId, Project, Result,
};

const PACKAGE: &str = "@knolo/mcp@0.2.4";

#[derive(Debug, Deserialize, JsonSchema)]
struct KnoloSettings {
    config_path: String,
}

struct KnoloExtension;

impl KnoloExtension {
    fn config_path(project: &Project) -> Result<String> {
        let settings = ContextServerSettings::for_project("knolo", project)?;
        let Some(value) = settings.settings else {
            return Err("missing config_path".into());
        };
        let parsed: KnoloSettings =
            serde_json::from_value(value).map_err(|_| "missing config_path".to_string())?;
        let config_path = parsed.config_path.trim();
        if config_path.is_empty() {
            return Err("missing config_path".into());
        }
        Ok(config_path.to_string())
    }
}

fn npx_command() -> Result<String> {
    let node = zed::node_binary_path()?;
    let (os, _architecture) = zed::current_platform();
    let windows = matches!(os, zed::Os::Windows);
    let npx_name = if windows { "npx.cmd" } else { "npx" };
    let index = if windows {
        node.rfind(['\\', '/'])
    } else {
        node.rfind('/')
    };
    let Some(index) = index else {
        return Err("node binary has no directory".into());
    };
    let separator = if windows && node.as_bytes().get(index) == Some(&b'\\') {
        '\\'
    } else {
        '/'
    };
    Ok(format!("{}{}{}", &node[..index], separator, npx_name))
}

impl zed::Extension for KnoloExtension {
    fn new() -> Self {
        Self
    }

    fn context_server_command(
        &mut self,
        _context_server_id: &ContextServerId,
        project: &Project,
    ) -> Result<Command> {
        let config_path = Self::config_path(project)?;
        Ok(Command {
            command: npx_command()?,
            args: vec!["-y".into(), PACKAGE.into(), "--config".into(), config_path],
            env: vec![],
        })
    }

    fn context_server_configuration(
        &mut self,
        _context_server_id: &ContextServerId,
        _project: &Project,
    ) -> Result<Option<ContextServerConfiguration>> {
        let installation_instructions =
            include_str!("../configuration/installation_instructions.md").to_string();
        let default_settings = include_str!("../configuration/default_settings.jsonc").to_string();
        let settings_schema = serde_json::to_string(&schemars::schema_for!(KnoloSettings))
            .map_err(|error| error.to_string())?;
        Ok(Some(ContextServerConfiguration {
            installation_instructions,
            default_settings,
            settings_schema,
        }))
    }
}

zed::register_extension!(KnoloExtension);
