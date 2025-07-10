#!/usr/bin/env bash

# Integration Branch Sync Script
# Syncs current branch with the central integration branch (daily sync)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# Configuration
INTEGRATION_BRANCH="feature/actor-ref-integration"

echo -e "${MAGENTA}🔄 Integration Branch Sync Script${NC}"
echo -e "${MAGENTA}===========================================${NC}"

# Get current branch
CURRENT_BRANCH=$(git branch --show-current)
echo -e "${GREEN}📍 Current branch:${NC} $CURRENT_BRANCH"

# Check if we're on the integration branch itself
if [ "$CURRENT_BRANCH" = "$INTEGRATION_BRANCH" ]; then
    echo -e "${YELLOW}⚠️  You're already on the integration branch${NC}"
    echo -e "${BLUE}Just pulling latest changes...${NC}"
    git pull origin $INTEGRATION_BRANCH
    exit 0
fi

# Stash any uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo -e "${YELLOW}📦 Stashing uncommitted changes...${NC}"
    git stash push -m "Auto-stash before integration sync"
    STASHED=true
else
    STASHED=false
fi

# Fetch latest changes
echo -e "${BLUE}🔍 Fetching latest changes from integration branch...${NC}"
git fetch origin $INTEGRATION_BRANCH:remotes/origin/$INTEGRATION_BRANCH || {
    echo -e "${RED}❌ Failed to fetch integration branch${NC}"
    exit 1
}

# Show what's incoming
echo -e "${BLUE}📊 Incoming changes from integration:${NC}"
git log --oneline --graph --decorate --max-count=10 HEAD..origin/$INTEGRATION_BRANCH

# Count incoming commits
INCOMING_COUNT=$(git rev-list --count HEAD..origin/$INTEGRATION_BRANCH)
if [ "$INCOMING_COUNT" -eq 0 ]; then
    echo -e "${GREEN}✅ Already up to date with integration branch${NC}"
    
    # Restore stash if needed
    if [ "$STASHED" = true ]; then
        echo -e "${YELLOW}📦 Restoring stashed changes...${NC}"
        git stash pop
    fi
    exit 0
fi

echo -e "${YELLOW}📥 Found $INCOMING_COUNT new commits from integration${NC}"

# Show which agents contributed
echo -e "${BLUE}👥 Contributors in incoming changes:${NC}"
git log --format="%an" HEAD..origin/$INTEGRATION_BRANCH | sort | uniq -c | sort -rn

# Prompt for confirmation
echo -e "${YELLOW}⚠️  This will merge integration changes into your current branch${NC}"
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}❌ Sync cancelled${NC}"
    
    # Restore stash if needed
    if [ "$STASHED" = true ]; then
        echo -e "${YELLOW}📦 Restoring stashed changes...${NC}"
        git stash pop
    fi
    exit 1
fi

# Perform the merge
echo -e "${BLUE}🔀 Merging integration changes...${NC}"
if git merge origin/$INTEGRATION_BRANCH --no-ff -m "sync: merge latest from integration branch"; then
    echo -e "${GREEN}✅ Successfully synced with integration branch${NC}"
    
    # Show summary of changes
    echo -e "${BLUE}📋 Summary of merged changes:${NC}"
    git diff --stat HEAD~1..HEAD
    
    # Categorize changes by agent responsibility
    echo -e "${BLUE}📁 Changes by category:${NC}"
    echo -e "${YELLOW}Architecture (Agent A):${NC}"
    git diff --name-only HEAD~1..HEAD | grep -E "(supervisor|actor-ref|request-response|architecture)" || echo "  None"
    
    echo -e "${YELLOW}Implementation (Agent B):${NC}"
    git diff --name-only HEAD~1..HEAD | grep -E "(mailbox|observable|event-bus|adapter|bridge)" || echo "  None"
    
    echo -e "${YELLOW}Testing (Agent C):${NC}"
    git diff --name-only HEAD~1..HEAD | grep -E "(\.test\.ts|\.spec\.ts|test-utils|fixtures|benchmarks)" || echo "  None"
    
else
    echo -e "${RED}❌ Merge conflicts detected${NC}"
    echo -e "${YELLOW}Please resolve conflicts and complete the merge${NC}"
    echo -e "${YELLOW}Files with conflicts:${NC}"
    git diff --name-only --diff-filter=U
    echo ""
    echo -e "${BLUE}💡 Conflict resolution tips:${NC}"
    echo -e "  1. For test conflicts, prefer the most comprehensive test"
    echo -e "  2. For implementation conflicts, check with the relevant agent"
    echo -e "  3. For architecture conflicts, Agent A (Tech Lead) has final say"
    
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

echo -e "${GREEN}✨ Integration sync complete!${NC}"
echo -e "${BLUE}Next steps:${NC}"
echo -e "  1. Review the merged changes"
echo -e "  2. Run tests: ${YELLOW}pnpm test${NC}"
echo -e "  3. Check types: ${YELLOW}pnpm typecheck${NC}"
echo -e "  4. Continue with your work"
echo ""
echo -e "${MAGENTA}📌 Remember:${NC} Run this sync daily before starting work!"