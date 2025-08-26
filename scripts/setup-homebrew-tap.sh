#!/bin/bash

set -e

echo "🍺 Setting up Homebrew tap for Schaltwerk"
echo ""
echo "This script will help you create the private Homebrew tap repository."
echo ""

REPO_NAME="homebrew-schaltwerk"
GITHUB_USER="mariuswichtner"

echo "📋 Prerequisites:"
echo "  1. GitHub account with access to create private repositories"
echo "  2. GitHub CLI (gh) or web access to create the repository"
echo "  3. Git configured with your GitHub credentials"
echo ""

read -p "Have you created the private repository ${GITHUB_USER}/${REPO_NAME} on GitHub? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "Please create a private repository at:"
    echo "https://github.com/${GITHUB_USER}/${REPO_NAME}"
    echo ""
    echo "Then run this script again."
    exit 1
fi

TEMP_DIR=$(mktemp -d)
echo "📁 Working in temporary directory: $TEMP_DIR"

cd "$TEMP_DIR"

echo "📥 Cloning the repository..."
git clone "git@github.com:${GITHUB_USER}/${REPO_NAME}.git"
cd "$REPO_NAME"

echo "📝 Creating Formula directory..."
mkdir -p Formula

echo "📄 Copying formula file..."
cp "$OLDPWD/homebrew/Formula/schaltwerk.rb" Formula/

echo "📄 Copying README..."
cp "$OLDPWD/homebrew/README.md" .

echo "📤 Committing and pushing..."
git add .
git commit -m "Initial Homebrew tap setup for Schaltwerk"
git push origin main

echo ""
echo "✅ Homebrew tap repository setup complete!"
echo ""
echo "🔧 Next steps:"
echo ""
echo "1. Create a GitHub Personal Access Token with 'repo' scope:"
echo "   https://github.com/settings/tokens/new"
echo ""
echo "2. Add the token as a secret in the main repository:"
echo "   - Go to: https://github.com/${GITHUB_USER}/schaltwerk/settings/secrets/actions"
echo "   - Create new secret named: HOMEBREW_TAP_TOKEN"
echo "   - Paste your personal access token"
echo ""
echo "3. Test the tap locally:"
echo "   brew tap ${GITHUB_USER}/schaltwerk https://github.com/${GITHUB_USER}/${REPO_NAME}.git"
echo ""
echo "4. Create a release:"
echo "   git tag v0.1.0"
echo "   git push origin v0.1.0"
echo ""
echo "The GitHub Actions workflow will automatically:"
echo "  - Build the application for both architectures"
echo "  - Create a GitHub release with the binaries"
echo "  - Update the Homebrew formula with the correct SHA256 values"

cd "$OLDPWD"
rm -rf "$TEMP_DIR"