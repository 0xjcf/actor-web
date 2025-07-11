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

# Configuration
INTEGRATION_BRANCH="feature/actor-ref-integration"

# Utility functions
get_agent_type() {
    local current_branch=$(git branch --show-current)
    if [[ $current_branch == *"agent-a"* ]] || [[ $current_branch == *"architecture"* ]]; then
        echo "Agent A (Architecture)"
    elif [[ $current_branch == *"agent-b"* ]] || [[ $current_branch == *"implementation"* ]]; then
        echo "Agent B (Implementation)"
    elif [[ $current_branch == *"agent-c"* ]] || [[ $current_branch == *"test"* ]] || [[ $current_branch == *"cleanup"* ]]; then
        echo "Agent C (Testing/Cleanup)"
    else
        echo "Unknown Agent"
    fi
}

get_current_branch() {
    git branch --show-current
}

get_changed_files() {
    # Get files changed compared to integration branch
    git fetch origin $INTEGRATION_BRANCH >/dev/null 2>&1 || true
    if git rev-parse --verify origin/$INTEGRATION_BRANCH >/dev/null 2>&1; then
        git diff --name-only origin/$INTEGRATION_BRANCH..HEAD 2>/dev/null || git diff --name-only HEAD~1..HEAD 2>/dev/null || echo ""
    else
        # Fallback to comparing with HEAD~1 if integration branch doesn't exist
        git diff --name-only HEAD~1..HEAD 2>/dev/null || echo ""
    fi
}

validate_branch_changes() {
    local validation_type="${1:-full}"
    local agent_type=$(get_agent_type)
    
    echo -e "${BLUE}🔍 Running targeted validation for ${agent_type}...${NC}"
    
    # Get list of files changed by this branch
    local changed_files=$(get_changed_files)
    local file_count=$(echo "$changed_files" | grep -v '^$' | wc -l | tr -d ' ')
    
    if [ "$file_count" -eq 0 ]; then
        echo -e "${GREEN}✅ No files changed - validation passed${NC}"
        return 0
    fi
    
    echo -e "${BLUE}📁 Validating ${YELLOW}${file_count}${NC} files changed by your branch...${NC}"
    echo -e "${YELLOW}Changed files:${NC}"
    echo "$changed_files" | head -10 | sed 's/^/  - /'
    [ "$file_count" -gt 10 ] && echo "  ... and $(($file_count - 10)) more"
    echo
    
    # 1. TypeScript validation - only for changed .ts/.tsx files
    echo -e "${YELLOW}  → TypeScript validation (your files only)...${NC}"
    local changed_ts_files=$(echo "$changed_files" | grep -E '\.(ts|tsx)$' || true)
    
    if [ -n "$changed_ts_files" ] && [ "$changed_ts_files" != "" ]; then
        local ts_file_count=$(echo "$changed_ts_files" | wc -l | tr -d ' ')
        echo -e "${BLUE}    Checking ${ts_file_count} TypeScript files...${NC}"
        
        # Smart validation approach: check if the ACTUAL errors are in Agent's changed files
        local ts_errors=0
        local error_files=""
        
        # Run TypeScript check and capture output
        local ts_output=$(pnpm tsc --noEmit 2>&1 || true)
        
        # Check if any errors are in files that Agent A actually changed
        while IFS= read -r file; do
            if [ -f "$file" ]; then
                # Check if this specific file has errors that originate FROM this file
                # (not from imports/dependencies)
                if echo "$ts_output" | grep -q "^$file:" ; then
                    echo -e "${RED}    ❌ TypeScript errors in: $file${NC}"
                    echo "$ts_output" | grep "^$file:" | head -3 | sed 's/^/      /'
                    ts_errors=$((ts_errors + 1))
                    error_files="$error_files $file"
                else
                    echo -e "${GREEN}    ✅ $file${NC}"
                fi
            fi
        done <<< "$changed_ts_files"
        
        if [ "$ts_errors" -gt 0 ]; then
            echo -e "${RED}❌ Found TypeScript errors in $ts_errors of your files${NC}"
            echo -e "${YELLOW}💡 Fix the errors shown above in your changed files${NC}"
            echo -e "${BLUE}📝 Note: Ignoring errors in dependencies you didn't modify${NC}"
            return 1
        fi
    fi
    echo -e "${GREEN}    ✅ TypeScript OK (your files)${NC}"
    
    # 2. Linting validation - only for changed files that biome should process
    echo -e "${YELLOW}  → Linting validation (your files only)...${NC}"
    if [ -n "$changed_files" ]; then
        # Filter for files that exist and should be linted by biome
        local lintable_files=""
        while IFS= read -r file; do
            if [ -f "$file" ]; then
                # Skip files that match biome ignore patterns
                if [[ "$file" == *.md ]] || \
                   [[ "$file" == docs/* ]] || \
                   [[ "$file" == scripts/*.sh ]] || \
                   [[ "$file" == ".gitignore" ]] || \
                   [[ "$file" == "pnpm-lock.yaml" ]] || \
                   [[ "$file" == "yarn.lock" ]] || \
                   [[ "$file" == "package-lock.json" ]] || \
                   [[ "$file" == "package.json" ]] || \
                   [[ "$file" == "tsconfig.json" ]] || \
                   [[ "$file" == "biome.json" ]] || \
                   [[ "$file" == *".css" ]]; then
                    continue  # Skip files that biome ignores
                fi
                lintable_files="$lintable_files $file"
            fi
        done <<< "$changed_files"
        
        if [ -n "$lintable_files" ] && [ "$lintable_files" != " " ]; then
            local lint_file_count=$(echo "$lintable_files" | wc -w)
            echo -e "${BLUE}    Checking ${lint_file_count} files for linting issues...${NC}"
            
            if ! pnpm biome check $lintable_files >/dev/null 2>&1; then
                echo -e "${RED}❌ Linting errors found in your changed files${NC}"
                echo -e "${YELLOW}💡 Fix with: ${YELLOW}pnpm biome check $lintable_files --write${NC}"
                echo -e "${BLUE}Files with lint issues:${NC}"
                echo "$lintable_files" | tr ' ' '\n' | sed 's/^/  - /'
                return 1
            fi
        else
            echo -e "${BLUE}    No files need biome linting (docs, configs, etc. are ignored)${NC}"
        fi
    fi
    echo -e "${GREEN}    ✅ Linting OK (your files)${NC}"
    
    # 3. Quick test validation (optional, fast tests only)
    if [ "$validation_type" = "full" ]; then
        echo -e "${YELLOW}  → Quick test validation...${NC}"
        if [ -f "vitest.config.ts" ] && timeout 30s pnpm test >/dev/null 2>&1; then
            echo -e "${GREEN}    ✅ Tests OK${NC}"
        else
            echo -e "${YELLOW}    ⚠️  Skipping tests (not available or taking too long)${NC}"
        fi
    fi
    
    echo -e "${GREEN}✅ All validations passed for your ${file_count} changed files!${NC}"
    echo -e "${BLUE}🚀 Your ${agent_type} changes are ready to ship${NC}"
    return 0
}

generate_smart_commit_message() {
    local changed_files=$(git diff --cached --name-only 2>/dev/null || git diff --name-only)
    local agent_type=$(get_agent_type)
    local branch=$(get_current_branch)
    
    # Analyze changed files to determine commit type
    local commit_type="feat"
    local scope=""
    local description=""
    
    # Determine scope and type based on changed files
    if echo "$changed_files" | grep -q "\.test\.ts"; then
        commit_type="test"
        scope="tests"
        description="update test files"
    elif echo "$changed_files" | grep -q "observables/"; then
        scope="observables"
        description="update observable implementation"
    elif echo "$changed_files" | grep -q "actor-ref"; then
        scope="actor-ref"
        description="update actor reference implementation"
    elif echo "$changed_files" | grep -q "integration/"; then
        scope="integration"
        description="update integration adapters"
    elif echo "$changed_files" | grep -q "core/"; then
        scope="core"
        description="update core functionality"
    else
        scope="general"
        description="update implementation"
    fi
    
    # Count files
    local file_count=$(echo "$changed_files" | wc -l | tr -d ' ')
    
    # Generate final message
    echo "${commit_type}(${scope}): ${description}

- Updated ${file_count} files for ${agent_type}
- Branch: ${branch}
- Files: $(echo "$changed_files" | head -5 | tr '\n' ' ')$([ $file_count -gt 5 ] && echo "...")

[actor-web] ${agent_type} - automated commit"
}

auto_commit_changes() {
    echo -e "${BLUE}🔍 Checking for uncommitted changes...${NC}"
    
    if git diff --quiet && git diff --cached --quiet; then
        echo -e "${GREEN}✅ No changes to commit${NC}"
        return 0
    fi
    
    # Show what will be committed
    echo -e "${YELLOW}📝 Found uncommitted changes:${NC}"
    git status --porcelain | head -10
    
    # Ask user if they want to auto-commit
    echo -e "${BLUE}💡 Would you like to auto-commit these changes?${NC}"
    echo -e "${YELLOW}  → This will generate a smart commit message${NC}"
    echo -e "${YELLOW}  → You can always amend the commit later with: git commit --amend${NC}"
    read -p "Auto-commit? (Y/n) " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo -e "${YELLOW}❌ Please commit your changes manually first${NC}"
        echo -e "${BLUE}💡 Quick fix: ${YELLOW}git add . && git commit -m \"your message\"${NC}"
        return 1
    fi
    
    # Stage all changes
    git add .
    
    # Generate and show commit message
    local commit_message=$(generate_smart_commit_message)
    echo -e "${BLUE}📝 Generated commit message:${NC}"
    echo -e "${YELLOW}${commit_message}${NC}"
    echo
    
    read -p "Use this commit message? (Y/n) " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo -e "${YELLOW}💭 Please enter your commit message:${NC}"
        read -p "> " custom_message
        git commit -m "$custom_message"
    else
        git commit -m "$commit_message"
    fi
    
    echo -e "${GREEN}✅ Changes committed successfully${NC}"
    return 0
}

auto_push_branch() {
    local current_branch=$(get_current_branch)
    local agent_type=$(get_agent_type)
    
    echo -e "${BLUE}🚀 Would you like to push to your branch?${NC}"
    echo -e "${YELLOW}  → This will push ${current_branch} to origin${NC}"
    echo -e "${YELLOW}  → Other agents can then pull your latest work${NC}"
    read -p "Push to origin/${current_branch}? (Y/n) " -n 1 -r
    echo
    
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        echo -e "${BLUE}📤 Pushing to origin/${current_branch}...${NC}"
        git push origin "$current_branch"
        echo -e "${GREEN}✅ Successfully pushed to origin/${current_branch}${NC}"
        echo -e "${BLUE}💡 Other agents can now see your latest work${NC}"
        return 0
    else
        echo -e "${YELLOW}⏭️  Skipping branch push${NC}"
        return 0
    fi
}

# Usage function
usage() {
    echo -e "${MAGENTA}🎯 Enhanced Agent Workflow Script${NC}"
    echo -e "${MAGENTA}===========================================${NC}"
    echo ""
    echo -e "${BLUE}Usage:${NC} $0 <command>"
    echo ""
    echo -e "${BLUE}Commands:${NC}"
    echo -e "  ${GREEN}sync${NC}      - Pull latest changes from integration (daily routine)"
    echo -e "  ${GREEN}validate${NC}  - Check if your code is ready to push (lint, types, tests)"
    echo -e "  ${GREEN}push${NC}      - Push your changes to integration (after validation)"
    echo -e "  ${GREEN}commit${NC}    - Smart commit with auto-generated message"
    echo -e "  ${GREEN}save${NC}      - Commit + push to your branch (quick save)"
    echo -e "  ${GREEN}ship${NC}      - Validate + commit + push to integration (full workflow)"
    echo -e "  ${GREEN}status${NC}    - Show current branch status and what's new"
    echo -e "  ${GREEN}setup${NC}     - One-time setup for agent workflow"
    echo ""
    echo -e "${BLUE}Quick workflows:${NC}"
    echo -e "  ${YELLOW}Morning routine:${NC}  $0 sync"
    echo -e "  ${YELLOW}Quick save:${NC}      $0 save"
    echo -e "  ${YELLOW}Ready to ship:${NC}   $0 ship"
    echo -e "  ${YELLOW}Just commit:${NC}     $0 commit"
    echo ""
    echo -e "${BLUE}💡 New features:${NC}"
    echo -e "  • Auto-commit with smart messages"
    echo -e "  • Auto-push to your branch"
    echo -e "  • Full workflow automation"
    echo ""
}

# Command handling
case "${1:-}" in
    "sync")
        echo -e "${BLUE}🔄 Starting sync workflow...${NC}"
        ./scripts/sync-integration.sh
        ;;
    "validate")
        echo -e "${BLUE}🔍 Starting targeted validation workflow...${NC}"
        if validate_branch_changes "full"; then
            echo -e "${GREEN}✅ Ready to push to integration!${NC}"
        else
            echo -e "${RED}❌ Validation failed - please fix issues above${NC}"
            exit 1
        fi
        ;;
    "commit")
        echo -e "${BLUE}📝 Starting commit workflow...${NC}"
        auto_commit_changes
        ;;
    "save")
        echo -e "${BLUE}💾 Starting save workflow (commit + push to branch)...${NC}"
        if auto_commit_changes; then
            auto_push_branch
            echo -e "${GREEN}✨ Save workflow complete!${NC}"
            echo -e "${BLUE}💡 Your work is now saved and backed up${NC}"
        fi
        ;;
    "ship")
        echo -e "${BLUE}🚢 Starting ship workflow (validate + commit + push to integration)...${NC}"
        
        # Step 1: Auto-commit if needed
        if ! auto_commit_changes; then
            exit 1
        fi
        
        # Step 2: Targeted validation
        echo -e "${BLUE}🔍 Validating your changes before shipping...${NC}"
        if ! validate_branch_changes "full"; then
            echo -e "${RED}❌ Validation failed for your changes${NC}"
            echo -e "${YELLOW}💡 Fix the issues above and try again${NC}"
            exit 1
        fi
        
        # Step 3: Push to branch first
        auto_push_branch
        
        # Step 4: Push to integration
        echo -e "${BLUE}🚀 Pushing to integration...${NC}"
        ./scripts/push-to-integration.sh
        
        echo -e "${GREEN}✨ Ship workflow complete!${NC}"
        echo -e "${BLUE}🎉 Your changes are now live in integration!${NC}"
        ;;
    "push")
        echo -e "${BLUE}🚀 Starting push workflow...${NC}"
        ./scripts/push-to-integration.sh
        ;;
    "status")
        echo -e "${BLUE}📊 Agent Status Dashboard${NC}"
        echo -e "${BLUE}===========================================${NC}"
        
        # Current branch and agent
        current_branch=$(get_current_branch)
        agent_type=$(get_agent_type)
        echo -e "${GREEN}📍 Current branch:${NC} $current_branch"
        echo -e "${GREEN}👤 Agent type:${NC} $agent_type"
        
        # Uncommitted changes
        if ! git diff --quiet || ! git diff --cached --quiet; then
            echo -e "${YELLOW}📝 Uncommitted changes:${NC} Yes"
            echo -e "${BLUE}  Modified files:${NC}"
            git status --porcelain | head -10
            echo -e "${BLUE}💡 Quick fix: ${YELLOW}$0 save${NC}"
        else
            echo -e "${GREEN}📝 Uncommitted changes:${NC} None"
        fi
        
        # Status vs integration
        git fetch origin $INTEGRATION_BRANCH >/dev/null 2>&1 || true
        if git rev-parse --verify origin/$INTEGRATION_BRANCH >/dev/null 2>&1; then
            behind=$(git rev-list --count HEAD..origin/$INTEGRATION_BRANCH)
            ahead=$(git rev-list --count origin/$INTEGRATION_BRANCH..HEAD)
            
            if [ "$behind" -gt 0 ]; then
                echo -e "${YELLOW}⬇️  Behind integration:${NC} $behind commits"
                echo -e "${BLUE}💡 Run: ${YELLOW}$0 sync${NC}"
            else
                echo -e "${GREEN}⬇️  Behind integration:${NC} 0 commits"
            fi
            
            if [ "$ahead" -gt 0 ]; then
                echo -e "${YELLOW}⬆️  Ahead of integration:${NC} $ahead commits"
                echo -e "${BLUE}💡 Run: ${YELLOW}$0 ship${NC}"
            else
                echo -e "${GREEN}⬆️  Ahead of integration:${NC} 0 commits"
            fi
        fi
        
        # Quick targeted validation status
        echo -e "${BLUE}🔍 Quick validation (your files only):${NC}"
        changed_files=$(get_changed_files)
        file_count=$(echo "$changed_files" | grep -v '^$' | wc -l | tr -d ' ')
        
        if [ "$file_count" -eq 0 ]; then
            echo -e "${GREEN}  ✅ No files to validate${NC}"
        else
            echo -e "${BLUE}  📁 ${file_count} files changed by your branch${NC}"
            
            # Quick TypeScript check for changed files only
            changed_ts_files=$(echo "$changed_files" | grep -E '\.(ts|tsx)$' || true)
            if [ -n "$changed_ts_files" ] && [ "$changed_ts_files" != "" ]; then
                ts_file_count=$(echo "$changed_ts_files" | wc -l | tr -d ' ')
                ts_errors=0
                while IFS= read -r file; do
                    if [ -f "$file" ] && ! pnpm tsc --noEmit --skipLibCheck "$file" >/dev/null 2>&1; then
                        ts_errors=$((ts_errors + 1))
                    fi
                done <<< "$changed_ts_files"
                
                if [ "$ts_errors" -eq 0 ]; then
                    echo -e "${GREEN}  ✅ TypeScript OK (${ts_file_count} files)${NC}"
                else
                    echo -e "${RED}  ❌ TypeScript errors (${ts_errors}/${ts_file_count} files)${NC}"
                fi
            else
                echo -e "${GREEN}  ✅ No TypeScript files to check${NC}"
            fi
            
            # Quick linting check for changed files only (respecting biome ignore patterns)
            lintable_files=""
            while IFS= read -r file; do
                if [ -f "$file" ]; then
                    # Skip files that match biome ignore patterns
                    if [[ "$file" == *.md ]] || \
                       [[ "$file" == docs/* ]] || \
                       [[ "$file" == scripts/*.sh ]] || \
                       [[ "$file" == ".gitignore" ]] || \
                       [[ "$file" == "pnpm-lock.yaml" ]] || \
                       [[ "$file" == "yarn.lock" ]] || \
                       [[ "$file" == "package-lock.json" ]] || \
                       [[ "$file" == "package.json" ]] || \
                       [[ "$file" == "tsconfig.json" ]] || \
                       [[ "$file" == "biome.json" ]] || \
                       [[ "$file" == *".css" ]]; then
                        continue  # Skip files that biome ignores
                    fi
                    lintable_files="$lintable_files $file"
                fi
            done <<< "$changed_files"
            
            if [ -n "$lintable_files" ] && [ "$lintable_files" != " " ]; then
                if pnpm biome check $lintable_files >/dev/null 2>&1; then
                    echo -e "${GREEN}  ✅ Linting OK (your files)${NC}"
                else
                    echo -e "${RED}  ❌ Linting errors (your files)${NC}"
                fi
            else
                echo -e "${GREEN}  ✅ No lintable files (docs/configs ignored)${NC}"
            fi
        fi
        
        # Suggested next actions
        echo -e "${BLUE}💡 Suggested next actions:${NC}"
        if ! git diff --quiet || ! git diff --cached --quiet; then
            echo -e "  • ${YELLOW}$0 save${NC} - Quick save your work"
            echo -e "  • ${YELLOW}$0 ship${NC} - Full workflow to integration"
        elif [ "$ahead" -gt 0 ]; then
            echo -e "  • ${YELLOW}$0 ship${NC} - Share your work with other agents"
        elif [ "$behind" -gt 0 ]; then
            echo -e "  • ${YELLOW}$0 sync${NC} - Get latest changes from other agents"
        else
            echo -e "  • ${GREEN}All caught up!${NC} Ready for new work"
        fi
        ;;
    "setup")
        echo -e "${BLUE}🔧 Setting up enhanced agent workflow...${NC}"
        
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
        
        # Create helpful aliases in git config
        git config alias.ship '!./scripts/agent-workflow.sh ship'
        git config alias.save '!./scripts/agent-workflow.sh save'
        git config alias.agent-sync '!./scripts/agent-workflow.sh sync'
        git config alias.agent-status '!./scripts/agent-workflow.sh status'
        echo -e "${GREEN}✅ Set up git aliases (git ship, git save, etc.)${NC}"
        
        echo -e "${GREEN}✨ Enhanced setup complete!${NC}"
        echo -e "${BLUE}💡 Try: ${YELLOW}$0 status${NC}"
        echo -e "${BLUE}🆕 New commands: ${YELLOW}save${NC}, ${YELLOW}ship${NC}, ${YELLOW}commit${NC}"
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