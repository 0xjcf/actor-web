#!/usr/bin/env bash

# Unified Agent Workflow Script
# One script to rule them all - handles sync, validate, and push operations

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# Usage function
usage() {
    echo -e "${MAGENTA}🎯 Agent Workflow Script${NC}"
    echo -e "${MAGENTA}===========================================${NC}"
    echo ""
    echo -e "${BLUE}Usage:${NC} $0 <command>"
    echo ""
    echo -e "${BLUE}Commands:${NC}"
    echo -e "  ${GREEN}sync${NC}      - Pull latest changes from integration (daily routine)"
    echo -e "  ${GREEN}validate${NC}  - Check if your code is ready to push (lint, types, tests)"
    echo -e "  ${GREEN}push${NC}      - Push your changes to integration (after validation)"
    echo -e "  ${GREEN}status${NC}    - Show current branch status and what's new"
    echo -e "  ${GREEN}setup${NC}     - One-time setup for agent workflow"
    echo ""
    echo -e "${BLUE}Quick workflows:${NC}"
    echo -e "  ${YELLOW}Morning routine:${NC}  $0 sync"
    echo -e "  ${YELLOW}Before commit:${NC}   $0 validate"
    echo -e "  ${YELLOW}End of day:${NC}      $0 push"
    echo ""
}

# Command handling
case "${1:-}" in
    "sync")
        echo -e "${BLUE}🔄 Starting sync workflow...${NC}"
        ./scripts/sync-integration.sh
        ;;
    "validate")
        echo -e "${BLUE}🔍 Starting validation workflow...${NC}"
        echo -e "${YELLOW}  → Checking TypeScript...${NC}"
        pnpm typecheck
        echo -e "${YELLOW}  → Checking linting...${NC}"
        pnpm lint
        echo -e "${YELLOW}  → Running tests...${NC}"
        pnpm test
        echo -e "${GREEN}✅ All validations passed! Ready to push.${NC}"
        ;;
    "push")
        echo -e "${BLUE}🚀 Starting push workflow...${NC}"
        ./scripts/push-to-integration.sh
        ;;
    "status")
        echo -e "${BLUE}📊 Agent Status Dashboard${NC}"
        echo -e "${BLUE}===========================================${NC}"
        
        # Current branch
        CURRENT_BRANCH=$(git branch --show-current)
        echo -e "${GREEN}📍 Current branch:${NC} $CURRENT_BRANCH"
        
        # Uncommitted changes
        if ! git diff --quiet || ! git diff --cached --quiet; then
            echo -e "${YELLOW}📝 Uncommitted changes:${NC} Yes"
            echo -e "${BLUE}  Modified files:${NC}"
            git status --porcelain | head -10
        else
            echo -e "${GREEN}📝 Uncommitted changes:${NC} None"
        fi
        
        # Status vs integration
        git fetch origin feature/actor-ref-integration >/dev/null 2>&1 || true
        if git rev-parse --verify origin/feature/actor-ref-integration >/dev/null 2>&1; then
            BEHIND=$(git rev-list --count HEAD..origin/feature/actor-ref-integration)
            AHEAD=$(git rev-list --count origin/feature/actor-ref-integration..HEAD)
            
            if [ "$BEHIND" -gt 0 ]; then
                echo -e "${YELLOW}⬇️  Behind integration:${NC} $BEHIND commits"
                echo -e "${BLUE}💡 Run: ${YELLOW}$0 sync${NC}"
            else
                echo -e "${GREEN}⬇️  Behind integration:${NC} 0 commits"
            fi
            
            if [ "$AHEAD" -gt 0 ]; then
                echo -e "${YELLOW}⬆️  Ahead of integration:${NC} $AHEAD commits"
                echo -e "${BLUE}💡 Run: ${YELLOW}$0 validate${NC} then ${YELLOW}$0 push${NC}"
            else
                echo -e "${GREEN}⬆️  Ahead of integration:${NC} 0 commits"
            fi
        fi
        
        # Quick validation status
        echo -e "${BLUE}🔍 Quick validation:${NC}"
        if pnpm typecheck >/dev/null 2>&1; then
            echo -e "${GREEN}  ✅ TypeScript OK${NC}"
        else
            echo -e "${RED}  ❌ TypeScript errors${NC}"
        fi
        
        if pnpm lint >/dev/null 2>&1; then
            echo -e "${GREEN}  ✅ Linting OK${NC}"
        else
            echo -e "${RED}  ❌ Linting errors${NC}"
        fi
        ;;
    "setup")
        echo -e "${BLUE}🔧 Setting up agent workflow...${NC}"
        
        # Make scripts executable
        chmod +x scripts/*.sh
        echo -e "${GREEN}✅ Made scripts executable${NC}"
        
        # Fetch all branches
        git fetch --all
        echo -e "${GREEN}✅ Fetched all remote branches${NC}"
        
        # Set up git hooks (optional)
        if [ ! -f ".git/hooks/pre-push" ]; then
            cat > .git/hooks/pre-push << 'EOF'
#!/bin/bash
# Auto-validate before push
echo "🔍 Running pre-push validation..."
pnpm typecheck && pnpm lint
EOF
            chmod +x .git/hooks/pre-push
            echo -e "${GREEN}✅ Set up pre-push validation hook${NC}"
        fi
        
        echo -e "${GREEN}✨ Setup complete!${NC}"
        echo -e "${BLUE}💡 Try: ${YELLOW}$0 status${NC}"
        ;;
    "help"|"-h"|"--help"|"")
        usage
        ;;
    *)
        echo -e "${RED}❌ Unknown command: $1${NC}"
        usage
        exit 1
        ;;
esac 