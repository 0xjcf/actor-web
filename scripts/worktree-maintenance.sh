#!/usr/bin/env bash
#
# Git Worktree Maintenance Script
# Provides automated cleanup and safety checks for the agent-centric workflow
#
# Usage: ./scripts/worktree-maintenance.sh [check|prune|safety-check]
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

echo -e "${MAGENTA}🔧 Git Worktree Maintenance Script${NC}"
echo -e "${MAGENTA}=====================================${NC}"

# Expected worktrees for this project
declare -A expected_worktrees=(
    ["actor-web-architecture"]="feature/agent-a"
    ["actor-web-implementation"]="feature/agent-b"  
    ["actor-web-tests"]="feature/agent-c"
)

check_worktrees() {
    echo -e "${BLUE}🔍 Checking worktree status...${NC}"
    
    # List current worktrees
    local current_worktrees=$(git worktree list --porcelain | grep "worktree " | cut -d' ' -f2)
    local main_repo=$(git rev-parse --show-toplevel)
    
    echo -e "${GREEN}📍 Main repository:${NC} $main_repo"
    echo -e "${GREEN}📁 Active worktrees:${NC}"
    
    git worktree list | while read -r line; do
        echo "  $line"
    done
    
    # Check for expected worktrees
    echo -e "${BLUE}✅ Expected worktrees status:${NC}"
    for worktree in "${!expected_worktrees[@]}"; do
        local path="../$worktree"
        if [ -d "$path" ]; then
            echo -e "${GREEN}  ✅ $worktree${NC} → $path"
        else
            echo -e "${YELLOW}  ⚠️  $worktree${NC} → $path (missing - run setup-agent-worktrees.sh)"
        fi
    done
    
    # Check for orphaned worktrees
    echo -e "${BLUE}🚮 Checking for orphaned worktrees...${NC}"
    local orphaned=false
    git worktree list --porcelain | grep "worktree " | cut -d' ' -f2 | while read -r wt_path; do
        if [ "$wt_path" != "$main_repo" ] && [ ! -d "$wt_path" ]; then
            echo -e "${RED}  ❌ Orphaned: $wt_path${NC}"
            orphaned=true
        fi
    done
    
    if [ "$orphaned" = false ]; then
        echo -e "${GREEN}  ✅ No orphaned worktrees found${NC}"
    fi
}

prune_worktrees() {
    echo -e "${BLUE}🚮 Pruning orphaned worktrees...${NC}"
    
    # Safe prune - only removes worktrees with missing directories
    local pruned_count=$(git worktree prune -v 2>&1 | grep -c "Removing worktrees" || echo "0")
    
    if [ "$pruned_count" -gt 0 ]; then
        echo -e "${GREEN}✅ Pruned $pruned_count orphaned worktrees${NC}"
    else
        echo -e "${GREEN}✅ No orphaned worktrees to prune${NC}"
    fi
}

safety_check() {
    echo -e "${BLUE}🛡️  Running safety checks...${NC}"
    
    # Check git config settings
    echo -e "${YELLOW}📋 Git configuration check:${NC}"
    
    local guess_remote=$(git config --get worktree.guessRemote || echo "unset")
    echo -e "  worktree.guessRemote: $guess_remote"
    
    if [ "$guess_remote" = "true" ]; then
        echo -e "${GREEN}  ✅ Automatic push tracking enabled${NC}"
    else
        echo -e "${YELLOW}  ⚠️  Consider enabling: git config worktree.guessRemote true${NC}"
    fi
    
    # Check for uncommitted changes across worktrees
    echo -e "${YELLOW}🔍 Checking for uncommitted changes across worktrees:${NC}"
    
    local has_changes=false
    git worktree list --porcelain | grep "worktree " | cut -d' ' -f2 | while read -r wt_path; do
        if [ -d "$wt_path" ]; then
            cd "$wt_path"
            local branch=$(git branch --show-current)
            if ! git diff --quiet || ! git diff --cached --quiet; then
                echo -e "${YELLOW}  ⚠️  Uncommitted changes in: $wt_path ($branch)${NC}"
                has_changes=true
            else
                echo -e "${GREEN}  ✅ Clean: $wt_path ($branch)${NC}"
            fi
        fi
    done
    
    # Check for untracked files that might be worktree artifacts
    echo -e "${YELLOW}🔍 Checking for potential worktree artifacts:${NC}"
    
    local artifacts=$(git status --porcelain | grep "^??" | grep -E "(worktree-|\.worktree)" || echo "")
    if [ -n "$artifacts" ]; then
        echo -e "${YELLOW}  ⚠️  Found potential worktree artifacts:${NC}"
        echo "$artifacts" | sed 's/^/    /'
        echo -e "${BLUE}  💡 Consider adding patterns to .gitignore${NC}"
    else
        echo -e "${GREEN}  ✅ No worktree artifacts detected${NC}"
    fi
    
    # Check available disk space
    echo -e "${YELLOW}💾 Disk space check:${NC}"
    local disk_usage=$(du -sh . | cut -f1)
    echo -e "  Current repo size: $disk_usage"
    
    # Worktree-specific safety suggestions
    echo -e "${BLUE}💡 Safety recommendations:${NC}"
    echo -e "  • Run ${YELLOW}git worktree prune${NC} monthly to clean orphaned worktrees"
    echo -e "  • Each agent should work only in their designated worktree"
    echo -e "  • Use ${YELLOW}./scripts/agent-workflow.sh status${NC} to check your agent's status"
    echo -e "  • Sync with integration branch daily using ${YELLOW}./scripts/agent-workflow.sh sync${NC}"
}

# Main command handling
case "${1:-check}" in
    "check")
        check_worktrees
        ;;
    "prune")
        prune_worktrees
        check_worktrees
        ;;
    "safety-check")
        safety_check
        ;;
    "all")
        check_worktrees
        echo ""
        prune_worktrees
        echo ""
        safety_check
        ;;
    "help"|"-h"|"--help")
        echo -e "${BLUE}Usage:${NC} $0 [command]"
        echo ""
        echo -e "${BLUE}Commands:${NC}"
        echo -e "  ${GREEN}check${NC}        - Check worktree status and health"
        echo -e "  ${GREEN}prune${NC}        - Remove orphaned worktrees"
        echo -e "  ${GREEN}safety-check${NC} - Run comprehensive safety checks"
        echo -e "  ${GREEN}all${NC}          - Run all checks and maintenance"
        echo ""
        echo -e "${BLUE}Scheduled usage:${NC}"
        echo -e "  Add to crontab: ${YELLOW}0 9 * * 1 cd /path/to/repo && ./scripts/worktree-maintenance.sh all${NC}"
        ;;
    *)
        echo -e "${RED}❌ Unknown command: $1${NC}"
        echo -e "${BLUE}Use:${NC} $0 help"
        exit 1
        ;;
esac

echo -e "${GREEN}✨ Worktree maintenance complete!${NC}" 