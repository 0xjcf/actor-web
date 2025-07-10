#!/usr/bin/env bash

# Agent C (Testing) Merge Script
# Merges latest changes from Agent C's testing branch into current branch

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
AGENT_C_BRANCH="feature/agent-c-testing"
INTEGRATION_BRANCH="feature/actor-ref-integration"

echo -e "${BLUE}🔄 Agent C Merge Script${NC}"
echo -e "${BLUE}===========================================${NC}"

# Get current branch
CURRENT_BRANCH=$(git branch --show-current)
echo -e "${GREEN}📍 Current branch:${NC} $CURRENT_BRANCH"

# Stash any uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo -e "${YELLOW}📦 Stashing uncommitted changes...${NC}"
    git stash push -m "Auto-stash before Agent C merge"
    STASHED=true
else
    STASHED=false
fi

# Fetch latest changes
echo -e "${BLUE}🔍 Fetching latest changes from remote...${NC}"
git fetch origin $AGENT_C_BRANCH:remotes/origin/$AGENT_C_BRANCH || {
    echo -e "${RED}❌ Failed to fetch Agent C branch${NC}"
    exit 1
}

# Show what's incoming
echo -e "${BLUE}📊 Incoming changes from Agent C:${NC}"
git log --oneline --graph --decorate --max-count=10 HEAD..origin/$AGENT_C_BRANCH

# Count incoming commits
INCOMING_COUNT=$(git rev-list --count HEAD..origin/$AGENT_C_BRANCH)
if [ "$INCOMING_COUNT" -eq 0 ]; then
    echo -e "${GREEN}✅ Already up to date with Agent C${NC}"
    
    # Restore stash if needed
    if [ "$STASHED" = true ]; then
        echo -e "${YELLOW}📦 Restoring stashed changes...${NC}"
        git stash pop
    fi
    exit 0
fi

echo -e "${YELLOW}📥 Found $INCOMING_COUNT new commits from Agent C${NC}"

# Prompt for confirmation
echo -e "${YELLOW}⚠️  This will merge Agent C's testing changes into your current branch${NC}"
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}❌ Merge cancelled${NC}"
    
    # Restore stash if needed
    if [ "$STASHED" = true ]; then
        echo -e "${YELLOW}📦 Restoring stashed changes...${NC}"
        git stash pop
    fi
    exit 1
fi

# Perform the merge
echo -e "${BLUE}🔀 Merging Agent C changes...${NC}"
if git merge origin/$AGENT_C_BRANCH --no-ff -m "merge: sync with Agent C testing changes"; then
    echo -e "${GREEN}✅ Successfully merged Agent C changes${NC}"
    
    # Show summary of changes
    echo -e "${BLUE}📋 Summary of merged changes:${NC}"
    git diff --stat HEAD~1..HEAD
    
    # Check for specific file types that Agent C typically works on
    echo -e "${BLUE}🧪 Test files changed:${NC}"
    git diff --name-only HEAD~1..HEAD | grep -E "(\.test\.ts|\.spec\.ts|test-utils|fixtures|benchmarks)" || echo "  No test-specific files"
    
else
    echo -e "${RED}❌ Merge conflicts detected${NC}"
    echo -e "${YELLOW}Please resolve conflicts and complete the merge${NC}"
    echo -e "${YELLOW}Files with conflicts:${NC}"
    git diff --name-only --diff-filter=U
    
    # Don't restore stash on conflict
    exit 1
fi

# Restore stash if needed
if [ "$STASHED" = true ]; then
    echo -e "${YELLOW}📦 Restoring stashed changes...${NC}"
    if ! git stash pop; then
        echo -e "${RED}⚠️  Stash restoration failed due to conflicts${NC}"
        echo -e "${YELLOW}Your changes are saved in the stash. Use 'git stash list' to see them${NC}"
    fi
fi

echo -e "${GREEN}✨ Agent C merge complete!${NC}"
echo -e "${BLUE}Next steps:${NC}"
echo -e "  1. Review the merged changes"
echo -e "  2. Run tests: ${YELLOW}pnpm test${NC}"
echo -e "  3. Check coverage: ${YELLOW}pnpm test:coverage${NC}"
echo -e "  4. Push when ready: ${YELLOW}git push${NC}"