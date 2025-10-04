cask "schaltwerk" do
  version "0.1.0"
  sha256 :no_check

  url "file:///Users/marius.wichtner/Documents/git/para-ui/.schaltwerk/worktrees/thirsty_mcnulty/src-tauri/target/release/bundle/macos/Schaltwerk-#{version}-universal.dmg"
  name "Schaltwerk"
  desc "Visual interface for managing Para sessions"
  homepage "https://github.com/2mawi2/para-ui"

  uninstall_preflight do
    staged_app = staged_path/"Schaltwerk.app"
    next unless staged_app.exist?

    # Clean up stale staged apps left behind by interrupted upgrades.
    next if staged_app.symlink?

    require "fileutils"
    FileUtils.rm_rf(staged_app)
  end

  app "Schaltwerk.app"

  uninstall delete: [
    "#{HOMEBREW_PREFIX}/bin/schaltwerk",
  ]

  zap trash: [
    "~/Library/Application Support/schaltwerk",
    "~/Library/Logs/schaltwerk",
    "~/Library/Preferences/com.mariuswichtner.schaltwerk.plist",
    "~/Library/Saved Application State/com.mariuswichtner.schaltwerk.savedState",
  ]
end
