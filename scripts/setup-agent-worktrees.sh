#!/usr/bin/env bash
#
# Setup Agent Worktrees for Actor-Web Framework
# 
# This script creates separate Git worktrees for each of the 3 agents,
# solving the "branch jumping" problem by giving each agent their own
# isolated working directory.
#
# Usage: ./scripts/setup-agent-worktrees.sh
#

set -e  # Exit on any error

echo "🌿 Setting up Actor-Web Agent Worktrees..."
echo ""

# Check if we're in the right directory
if [[ ! -f "package.json" ]] || [[ ! -d ".git" ]]; then
    echo "❌ Error: Please run this script from the actor-web repository root"
    exit 1
fi

# Agent branch mappings
declare -A branches=(
    ["architecture"]="feature/actor-ref-architecture"
    ["implementation"]="feature/actor-ref-implementation"  
    ["tests"]="feature/actor-ref-tests"
)

# Create worktrees for each agent
for dir in "${!branches[@]}"; do
    branch="${branches[$dir]}"
    worktree_path="../actor-web-${dir}"
    
    echo "📁 Setting up worktree: ${worktree_path} -> ${branch}"
    
    # Try to add worktree with existing remote branch, or create new branch
    if git show-ref --verify --quiet "refs/remotes/origin/${branch}"; then
        # Remote branch exists, create worktree from it
        git worktree add -B "$branch" "$worktree_path" "origin/$branch" 2>/dev/null || {
            echo "⚠️  Worktree ${worktree_path} already exists, skipping..."
            continue
        }
    else
        # Remote branch doesn't exist, create new branch
        git worktree add "$worktree_path" -b "$branch" 2>/dev/null || {
            echo "⚠️  Worktree ${worktree_path} already exists, skipping..."
            continue
        }
        echo "   Created new branch: ${branch}"
    fi
    
    echo "   ✅ Created: ${worktree_path}"
done

echo ""
echo "🎯 Configuring Git settings..."

# Configure automatic push tracking for all worktrees
git config --global worktree.guessRemote true
echo "   ✅ Enabled automatic push tracking"

echo ""
echo "🎉 Worktrees setup complete!"
echo ""
echo "📋 Next steps for each agent:"
echo ""
echo "🔧 Agent A (Tech Lead - Architecture):"
echo "   cd ../actor-web-architecture"
echo "   # Open this directory in Cursor IDE"
echo ""
echo "💻 Agent B (Senior Dev - Implementation):"
echo "   cd ../actor-web-implementation"
echo "   # Use this directory for all implementation work"
echo ""
echo "🧪 Agent C (Junior Dev - Testing):"
echo "   cd ../actor-web-tests"
echo "   # Use this directory for all testing work"
echo ""
echo "📚 Each agent now has an independent workspace!"
echo "   - No more branch jumping conflicts"
echo "   - Shared Git history and objects"
echo "   - Minimal disk space usage"
echo ""
echo "🔄 Daily workflow:"
echo "   1. Work in your agent directory"
echo "   2. Commit and push your changes"
echo "   3. Sync with integration branch daily"
echo ""
echo "📖 See docs/IMPLEMENTATION.md for detailed workflow instructions." 