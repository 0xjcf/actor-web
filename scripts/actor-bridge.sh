#!/bin/bash

# Actor Bridge - Enables shell scripts to use actor-based git operations when available
# Falls back to shell-based operations when actor system is not ready

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in a Node.js environment with the CLI package
is_actor_system_available() {
    local cli_package_path="packages/agent-workflow-cli"
    
    if [ -d "$cli_package_path" ] && [ -f "$cli_package_path/package.json" ]; then
        # Check if the CLI package source exists (it doesn't need to be built)
        if [ -f "$cli_package_path/src/actors/git-actor.ts" ]; then
            return 0  # Actor system is available
        fi
    fi
    
    return 1  # Fall back to shell scripts
}

# Generate commit message using actor system or shell fallback
generate_commit_message_with_actor() {
    if is_actor_system_available; then
        echo -e "${BLUE}🎭 Using actor-based commit message generation...${NC}"
        
        # Try to use the actor-based system
        if command -v pnpm >/dev/null 2>&1; then
            local actor_result=$(pnpm --filter @agent-workflow/cli dev generate-message 2>/dev/null)
            if [ $? -eq 0 ] && [ -n "$actor_result" ]; then
                echo "$actor_result"
                return 0
            fi
        fi
        
        echo -e "${YELLOW}⚠️  Actor system available but not responding, falling back to shell...${NC}"
    fi
    
    # Fall back to shell-based generation
    echo -e "${BLUE}🐚 Using shell-based commit message generation...${NC}"
    source "${BASH_SOURCE%/*}/agent-workflow.sh"
    generate_smart_commit_message
}

# Validate dates using actor system or shell fallback
validate_dates_with_actor() {
    local files_to_check="$1"
    
    if is_actor_system_available; then
        echo -e "${BLUE}🎭 Using actor-based date validation...${NC}"
        
        # Try to use the actor-based system
        if command -v pnpm >/dev/null 2>&1; then
            local actor_result=$(pnpm --filter @agent-workflow/cli dev validate-dates "$files_to_check" 2>/dev/null)
            if [ $? -eq 0 ]; then
                echo "$actor_result"
                return 0
            fi
        fi
        
        echo -e "${YELLOW}⚠️  Actor system available but not responding, falling back to shell...${NC}"
    fi
    
    # Fall back to shell-based validation
    echo -e "${BLUE}🐚 Using shell-based date validation...${NC}"
    source "${BASH_SOURCE%/*}/date-utils.sh"
    
    # Validate each file
    for file in $files_to_check; do
        if [ -f "$file" ]; then
            fix_documentation_dates "$file"
        fi
    done
}

# Commit with convention using actor system or shell fallback
commit_with_convention() {
    local custom_message="$1"
    
    if is_actor_system_available; then
        echo -e "${BLUE}🎭 Using actor-based conventional commit...${NC}"
        
        # Try to use the actor-based system
        if command -v pnpm >/dev/null 2>&1; then
            local actor_result
            if [ -n "$custom_message" ]; then
                actor_result=$(pnpm --filter @agent-workflow/cli dev commit-with-convention --message "$custom_message" 2>/dev/null)
            else
                actor_result=$(pnpm --filter @agent-workflow/cli dev commit-with-convention 2>/dev/null)
            fi
            
            if [ $? -eq 0 ]; then
                echo "$actor_result"
                return 0
            fi
        fi
        
        echo -e "${YELLOW}⚠️  Actor system available but not responding, falling back to shell...${NC}"
    fi
    
    # Fall back to shell-based commit
    echo -e "${BLUE}🐚 Using shell-based conventional commit...${NC}"
    source "${BASH_SOURCE%/*}/agent-workflow.sh"
    
    if [ -n "$custom_message" ]; then
        git add .
        git commit -m "$custom_message"
    else
        auto_commit_changes
    fi
}

# Get system status (actor vs shell)
get_system_status() {
    echo -e "${BLUE}🔍 Actor Bridge System Status${NC}"
    echo -e "${BLUE}==============================${NC}"
    
    if is_actor_system_available; then
        echo -e "${GREEN}✅ Actor system: Available${NC}"
        echo -e "${GREEN}   📦 CLI package: Found${NC}"
        
        if command -v pnpm >/dev/null 2>&1; then
            echo -e "${GREEN}   🔧 PNPM: Available${NC}"
        else
            echo -e "${YELLOW}   ⚠️  PNPM: Not found${NC}"
        fi
        
        # Check if CLI is built
        if [ -f "packages/agent-workflow-cli/dist/index.js" ]; then
            echo -e "${GREEN}   🏗️  CLI built: Yes${NC}"
        else
            echo -e "${YELLOW}   🏗️  CLI built: No (using source)${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️  Actor system: Not available${NC}"
        echo -e "${YELLOW}   📦 CLI package: Not found${NC}"
    fi
    
    echo -e "${BLUE}🐚 Shell system: Always available${NC}"
    echo ""
    
    if is_actor_system_available; then
        echo -e "${GREEN}💡 Recommended: Use actor-based operations for better integration${NC}"
    else
        echo -e "${YELLOW}💡 Info: Using shell-based operations (actor system not ready)${NC}"
    fi
}

# Enhanced workflow that uses best available system
enhanced_workflow() {
    local action="$1"
    
    case "$action" in
        "commit")
            echo -e "${BLUE}🔄 Enhanced Commit Workflow${NC}"
            commit_with_convention
            ;;
        "generate-message")
            echo -e "${BLUE}🔄 Enhanced Message Generation${NC}"
            generate_commit_message_with_actor
            ;;
        "validate-dates")
            echo -e "${BLUE}🔄 Enhanced Date Validation${NC}"
            local files="${2:-$(find docs/ src/ -name '*.md' 2>/dev/null | head -10)}"
            validate_dates_with_actor "$files"
            ;;
        "status")
            get_system_status
            ;;
        *)
            echo -e "${RED}❌ Unknown action: $action${NC}"
            echo "Usage: $0 {commit|generate-message|validate-dates|status}"
            exit 1
            ;;
    esac
}

# Command handling
case "${1:-}" in
    "commit")
        commit_with_convention "$2"
        ;;
    "generate-message")
        generate_commit_message_with_actor
        ;;
    "validate-dates")
        validate_dates_with_actor "$2"
        ;;
    "status")
        get_system_status
        ;;
    "workflow")
        enhanced_workflow "$2" "$3"
        ;;
    *)
        echo -e "${BLUE}🌉 Actor Bridge - Hybrid Git Operations${NC}"
        echo -e "${BLUE}======================================${NC}"
        echo ""
        echo "Usage: $0 <command> [arguments]"
        echo ""
        echo "Commands:"
        echo -e "  ${GREEN}commit [message]${NC}       - Commit with convention (actor or shell)"
        echo -e "  ${GREEN}generate-message${NC}       - Generate smart commit message"
        echo -e "  ${GREEN}validate-dates [files]${NC}  - Validate dates in files"
        echo -e "  ${GREEN}status${NC}                 - Show system status"
        echo -e "  ${GREEN}workflow <action>${NC}      - Run enhanced workflow"
        echo ""
        echo "Features:"
        echo -e "  • ${YELLOW}Automatic fallback${NC} from actor to shell system"
        echo -e "  • ${YELLOW}Best available method${NC} for each operation"
        echo -e "  • ${YELLOW}Seamless integration${NC} with existing workflows"
        echo ""
        ;;
esac 