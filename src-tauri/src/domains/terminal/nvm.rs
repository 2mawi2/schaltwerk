use std::path::{Path, PathBuf};

pub fn nvm_bin_paths(home: &str, cwd: &str) -> Vec<String> {
    let nvm_dir = PathBuf::from(home).join(".nvm");
    if !nvm_dir.is_dir() {
        return Vec::new();
    }

    let mut seen = std::collections::HashSet::new();
    let mut candidates = Vec::new();

    if let Some(bin) = nvm_bin_from_nvmrc(&nvm_dir, cwd) {
        push_unique(&mut candidates, &mut seen, bin);
    }

    let legacy_current = nvm_dir.join("current").join("bin");
    if legacy_current.is_dir() {
        push_unique(
            &mut candidates,
            &mut seen,
            legacy_current.to_string_lossy().into_owned(),
        );
    }

    let versions_current = nvm_dir
        .join("versions")
        .join("node")
        .join("current")
        .join("bin");
    if versions_current.is_dir() {
        push_unique(
            &mut candidates,
            &mut seen,
            versions_current.to_string_lossy().into_owned(),
        );
    }

    if let Some(bin) = nvm_default_bin(&nvm_dir) {
        push_unique(&mut candidates, &mut seen, bin);
    }

    if let Some(latest) = nvm_latest_bin(&nvm_dir) {
        push_unique(&mut candidates, &mut seen, latest);
    }

    candidates
}

fn push_unique(out: &mut Vec<String>, seen: &mut std::collections::HashSet<String>, value: String) {
    if seen.insert(value.clone()) {
        out.push(value);
    }
}

fn nvm_bin_from_nvmrc(nvm_dir: &Path, cwd: &str) -> Option<String> {
    let cwd_path = Path::new(cwd);
    let cwd_dir = if cwd_path.is_dir() {
        cwd_path
    } else {
        cwd_path.parent()?
    };

    let home_dir = nvm_dir.parent()?;
    let nvmrc_path = find_nvmrc(cwd_dir, home_dir)?;
    let raw = std::fs::read_to_string(nvmrc_path).ok()?;
    let spec = raw.trim();
    if spec.is_empty() {
        return None;
    }

    let version_dir = resolve_nvm_version_dir(nvm_dir, spec)?;
    let bin = nvm_dir
        .join("versions")
        .join("node")
        .join(version_dir)
        .join("bin");
    bin.is_dir().then(|| bin.to_string_lossy().into_owned())
}

fn find_nvmrc(start: &Path, stop_at: &Path) -> Option<PathBuf> {
    let mut current = start;
    loop {
        let candidate = current.join(".nvmrc");
        if candidate.is_file() {
            return Some(candidate);
        }

        if current == stop_at {
            break;
        }

        let parent = current.parent()?;
        if parent == current {
            break;
        }
        current = parent;
    }
    None
}

fn resolve_nvm_version_dir(nvm_dir: &Path, spec: &str) -> Option<String> {
    let trimmed = spec.trim();
    if trimmed.is_empty() || trimmed == "system" {
        return None;
    }

    if looks_like_version_spec(trimmed) {
        return resolve_installed_version_dir(nvm_dir, trimmed);
    }

    if let Some(version_dir) = resolve_nvm_alias_to_version_dir(nvm_dir, trimmed)
        .and_then(|resolved| resolve_nvm_version_dir(nvm_dir, &resolved))
    {
        return Some(version_dir);
    }

    if trimmed == "lts/*" {
        return nvm_latest_installed_lts_dir(nvm_dir);
    }

    None
}

fn looks_like_version_spec(value: &str) -> bool {
    let without_v = value.strip_prefix('v').unwrap_or(value);
    without_v
        .chars()
        .next()
        .is_some_and(|ch| ch.is_ascii_digit())
}

fn resolve_installed_version_dir(nvm_dir: &Path, spec: &str) -> Option<String> {
    let (major, minor, patch) = parse_nvm_version_spec(spec)?;

    let node_versions_dir = nvm_dir.join("versions").join("node");
    let entries = std::fs::read_dir(&node_versions_dir).ok()?;

    let mut best: Option<((u64, u64, u64), String)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };

        let Some(version) = parse_nvm_version_triplet(name) else {
            continue;
        };

        if version.0 != major {
            continue;
        }
        if minor.is_some_and(|wanted| version.1 != wanted) {
            continue;
        }
        if patch.is_some_and(|wanted| version.2 != wanted) {
            continue;
        }

        match best.as_ref() {
            Some((best_version, _)) if *best_version >= version => {}
            _ => best = Some((version, name.to_string())),
        }
    }

    best.map(|(_, dir)| dir)
}

fn parse_nvm_version_spec(spec: &str) -> Option<(u64, Option<u64>, Option<u64>)> {
    let trimmed = spec.trim();
    if trimmed.is_empty() {
        return None;
    }

    let without_v = trimmed.strip_prefix('v').unwrap_or(trimmed);
    if without_v.is_empty() {
        return None;
    }

    let mut parts = without_v.split('.');
    let major = parts.next().and_then(parse_leading_digits)?;
    let minor = parts.next().and_then(parse_leading_digits);
    let patch = parts.next().and_then(parse_leading_digits);

    Some((major, minor, patch))
}

fn resolve_nvm_alias_to_version_dir(nvm_dir: &Path, alias: &str) -> Option<String> {
    let mut current = alias.trim().to_string();
    for _ in 0..10 {
        let trimmed = current.trim();
        if trimmed.is_empty() || trimmed == "system" {
            return None;
        }

        if looks_like_version_spec(trimmed) {
            return Some(trimmed.to_string());
        }

        let alias_path = nvm_alias_file_path(nvm_dir, trimmed);
        current = std::fs::read_to_string(alias_path).ok()?;
    }
    None
}

fn nvm_alias_file_path(nvm_dir: &Path, alias: &str) -> PathBuf {
    let mut path = nvm_dir.join("alias");
    for component in alias.split('/') {
        if component.is_empty() || component == "." || component == ".." {
            continue;
        }
        path = path.join(component);
    }
    path
}

fn nvm_default_bin(nvm_dir: &Path) -> Option<String> {
    let default_alias_path = nvm_dir.join("alias").join("default");
    let alias = std::fs::read_to_string(default_alias_path).ok()?;
    let version_dir = resolve_nvm_version_dir(nvm_dir, alias.trim())?;

    let candidate = nvm_dir
        .join("versions")
        .join("node")
        .join(version_dir)
        .join("bin");

    candidate
        .is_dir()
        .then(|| candidate.to_string_lossy().into_owned())
}

fn nvm_latest_installed_lts_dir(nvm_dir: &Path) -> Option<String> {
    let node_versions_dir = nvm_dir.join("versions").join("node");
    let entries = std::fs::read_dir(&node_versions_dir).ok()?;

    let mut best: Option<((u64, u64, u64), String)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(version) = parse_nvm_version_triplet(name) else {
            continue;
        };
        if version.0 % 2 != 0 {
            continue;
        }
        match best.as_ref() {
            Some((best_version, _)) if *best_version >= version => {}
            _ => best = Some((version, name.to_string())),
        }
    }

    best.map(|(_, name)| name)
}

fn nvm_latest_bin(nvm_dir: &Path) -> Option<String> {
    let node_versions_dir = nvm_dir.join("versions").join("node");
    let entries = std::fs::read_dir(&node_versions_dir).ok()?;

    let mut best: Option<((u64, u64, u64), PathBuf)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(version) = parse_nvm_version_triplet(name) else {
            continue;
        };
        match best.as_ref() {
            Some((best_version, _)) if *best_version >= version => {}
            _ => best = Some((version, path)),
        }
    }

    let (_, version_path) = best?;
    let bin_path = version_path.join("bin");
    bin_path
        .is_dir()
        .then(|| bin_path.to_string_lossy().into_owned())
}

fn parse_nvm_version_triplet(name: &str) -> Option<(u64, u64, u64)> {
    let trimmed = name.trim();
    let version = trimmed.strip_prefix('v').unwrap_or(trimmed);
    if version.is_empty() || !version.chars().next().is_some_and(|ch| ch.is_ascii_digit()) {
        return None;
    }

    let mut parts = version.split('.').take(3);
    let major = parts.next().and_then(parse_leading_digits)?;
    let minor = parts.next().and_then(parse_leading_digits).unwrap_or(0);
    let patch = parts.next().and_then(parse_leading_digits).unwrap_or(0);

    Some((major, minor, patch))
}

fn parse_leading_digits(part: &str) -> Option<u64> {
    let digits: String = part.chars().take_while(|ch| ch.is_ascii_digit()).collect();
    if digits.is_empty() {
        None
    } else {
        digits.parse::<u64>().ok()
    }
}

#[cfg(test)]
mod tests {
    use super::nvm_bin_paths;
    use std::fs;

    #[test]
    fn prefers_nvmrc_version_over_default() {
        let temp_home = tempfile::tempdir().expect("temp home");
        let temp_cwd = tempfile::tempdir().expect("temp cwd");

        let alias_dir = temp_home.path().join(".nvm").join("alias");
        let v18_bin = temp_home
            .path()
            .join(".nvm")
            .join("versions")
            .join("node")
            .join("v18.19.0")
            .join("bin");
        let v20_bin = temp_home
            .path()
            .join(".nvm")
            .join("versions")
            .join("node")
            .join("v20.11.0")
            .join("bin");

        fs::create_dir_all(&alias_dir).expect("alias dir");
        fs::create_dir_all(&v18_bin).expect("v18 bin");
        fs::create_dir_all(&v20_bin).expect("v20 bin");
        fs::write(alias_dir.join("default"), "v20.11.0\n").expect("default alias");

        fs::write(temp_cwd.path().join(".nvmrc"), "18\n").expect("nvmrc");

        let paths = nvm_bin_paths(
            &temp_home.path().to_string_lossy(),
            &temp_cwd.path().to_string_lossy(),
        );
        let v18 = v18_bin.to_string_lossy().into_owned();
        let v20 = v20_bin.to_string_lossy().into_owned();
        let pos18 = paths.iter().position(|p| p == &v18).expect("v18 present");
        let pos20 = paths.iter().position(|p| p == &v20).expect("v20 present");
        assert!(
            pos18 < pos20,
            "expected .nvmrc version to win: {paths:?}"
        );
    }

    #[test]
    fn resolves_lts_wildcard_via_alias_chain_when_available() {
        let temp_home = tempfile::tempdir().expect("temp home");
        let temp_cwd = tempfile::tempdir().expect("temp cwd");

        let nvm_dir = temp_home.path().join(".nvm");
        let alias_lts_dir = nvm_dir.join("alias").join("lts");
        let v20_bin = nvm_dir
            .join("versions")
            .join("node")
            .join("v20.11.0")
            .join("bin");
        let v22_bin = nvm_dir
            .join("versions")
            .join("node")
            .join("v22.0.0")
            .join("bin");

        fs::create_dir_all(&alias_lts_dir).expect("alias lts dir");
        fs::create_dir_all(&v20_bin).expect("v20 bin");
        fs::create_dir_all(&v22_bin).expect("v22 bin");
        fs::write(alias_lts_dir.join("*"), "lts/custom\n").expect("lts wildcard alias");
        fs::write(alias_lts_dir.join("custom"), "v20.11.0\n").expect("lts custom alias");

        fs::write(temp_cwd.path().join(".nvmrc"), "lts/*\n").expect("nvmrc");

        let paths = nvm_bin_paths(
            &temp_home.path().to_string_lossy(),
            &temp_cwd.path().to_string_lossy(),
        );
        let v20 = v20_bin.to_string_lossy().into_owned();
        let v22 = v22_bin.to_string_lossy().into_owned();
        let pos20 = paths.iter().position(|p| p == &v20).expect("v20 present");
        let pos22 = paths.iter().position(|p| p == &v22).expect("v22 present");
        assert!(
            pos20 < pos22,
            "expected lts/* to resolve via alias chain: {paths:?}"
        );
    }
}

