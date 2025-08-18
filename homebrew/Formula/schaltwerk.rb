class Schaltwerk < Formula
  desc "Visual interface for managing Para sessions"
  homepage "https://github.com/2mawi2/para-ui"
  version "0.1.0"
  
  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/2mawi2/para-ui/releases/download/v#{version}/schaltwerk-#{version}-aarch64-apple-darwin.tar.gz"
      sha256 "PLACEHOLDER_ARM_SHA256" # aarch64
    else
      url "https://github.com/2mawi2/para-ui/releases/download/v#{version}/schaltwerk-#{version}-x86_64-apple-darwin.tar.gz"
      sha256 "PLACEHOLDER_INTEL_SHA256" # x86_64
    end
  end

  depends_on :macos

  def install
    app = "Schaltwerk.app"
    
    (libexec/"bin").install app
    
    system "codesign", "--force", "--deep", "--sign", "-", "#{libexec}/bin/#{app}"
    system "xattr", "-cr", "#{libexec}/bin/#{app}"
    
    (bin/"schaltwerk").write <<~EOS
      #!/bin/bash
      exec "#{libexec}/bin/#{app}/Contents/MacOS/schaltwerk" "$@"
    EOS
    (bin/"schaltwerk").chmod 0755
    
    ohai "Installation complete!"
    ohai ""
    ohai "IMPORTANT: First-time setup required"
    ohai "======================================"
    ohai ""
    ohai "Since this app is not signed with an Apple Developer certificate,"
    ohai "you'll need to approve it in System Settings on first launch:"
    ohai ""
    ohai "1. Try to open Schaltwerk (it will be blocked)"
    ohai "2. Open System Settings > Privacy & Security"
    ohai "3. Find 'Schaltwerk was blocked' message"
    ohai "4. Click 'Open Anyway'"
    ohai "5. Confirm when prompted"
    ohai ""
    ohai "This is only needed once. The app will work normally afterwards."
    ohai ""
    ohai "To launch: schaltwerk"
  end

  def caveats
    <<~EOS
      To use Schaltwerk, you may need to grant additional permissions:
      
      - Terminal access: for PTY functionality
      - File system access: for session management
      
      The app will prompt for these permissions when needed.
    EOS
  end

  test do
    assert_predicate prefix/"Schaltwerk.app", :exist?
    assert_predicate prefix/"Schaltwerk.app/Contents/MacOS/schaltwerk", :executable?
  end
end