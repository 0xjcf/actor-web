#!/bin/bash

# Commit Configuration for Actor Web Architecture Projects
# Provides configurable project tags and context-aware settings

# Default configuration
DEFAULT_PROJECT_TAG="actor-web"
DEFAULT_PROJECT_NAME="Actor Web Architecture"

# Auto-detect project type and configuration
detect_project_config() {
    local current_dir=$(pwd)
    local project_tag=""
    local project_name=""
    local agent_context=""
    
    # Check if we're in a specific package directory
    if [[ "$current_dir" == *"/packages/agent-workflow-cli"* ]]; then
        project_tag="actor-workflow-cli"
        project_name="Agent Workflow CLI"
        agent_context="CLI Tool"
    elif [[ "$current_dir" == *"/packages/"* ]]; then
        # Extract package name from directory
        local package_name=$(basename "$current_dir")
        project_tag="$package_name"
        project_name="$(echo $package_name | sed 's/-/ /g' | sed 's/\b\w/\u&/g')"
        agent_context="Package"
    else
        # Default to main project
        project_tag="$DEFAULT_PROJECT_TAG"
        project_name="$DEFAULT_PROJECT_NAME"
        agent_context="Framework"
    fi
    
    # Check for custom config file
    if [ -f ".commit-config" ]; then
        source ".commit-config"
    fi
    
    # Export configuration
    export PROJECT_TAG="${PROJECT_TAG:-$project_tag}"
    export PROJECT_NAME="${PROJECT_NAME:-$project_name}"
    export AGENT_CONTEXT="${AGENT_CONTEXT:-$agent_context}"
}

# Generate project-specific commit footer
get_commit_footer() {
    local agent_type="$1"
    local work_category="$2"
    
    detect_project_config
    
    echo "[$PROJECT_TAG] $agent_type - $work_category"
}

# Get project-specific scope suggestions
get_project_scopes() {
    detect_project_config
    
    case "$PROJECT_TAG" in
        "actor-web")
            echo "core actor-ref architecture types integration services components observables animation accessibility persistence tests docs build config deps"
            ;;
        "actor-workflow-cli")
            echo "cli commands core git-operations validation actors config build deps"
            ;;
        *)
            echo "core implementation tests docs build config deps"
            ;;
    esac
}

# Check if we're in a monorepo package
is_package_context() {
    [[ "$(pwd)" == *"/packages/"* ]]
}

# Get the current package name if in a package
get_current_package() {
    if is_package_context; then
        basename "$(pwd)"
    else
        echo "root"
    fi
}

# Generate context-aware commit scope
suggest_commit_scope() {
    local changed_files="$1"
    local suggested_scopes=($(get_project_scopes))
    
    # Analyze changed files for scope suggestions
    for scope in "${suggested_scopes[@]}"; do
        if echo "$changed_files" | grep -q "$scope"; then
            echo "$scope"
            return
        fi
    done
    
    # Fallback based on file types
    if echo "$changed_files" | grep -q "\.test\."; then
        echo "tests"
    elif echo "$changed_files" | grep -q "\.md$"; then
        echo "docs"
    elif echo "$changed_files" | grep -q "package\.json\|pnpm-lock"; then
        echo "deps"
    elif echo "$changed_files" | grep -q "\.config\.\|biome\.json\|tsconfig\.json"; then
        echo "config"
    else
        echo "core"
    fi
}

# Create a sample config file
create_sample_config() {
    cat > ".commit-config.sample" << 'EOF'
# Commit Configuration for Actor Web Architecture
# Copy this file to .commit-config to customize

# Project identification
PROJECT_TAG="actor-web"
PROJECT_NAME="Actor Web Architecture"
AGENT_CONTEXT="Framework"

# Commit message customization
COMMIT_PREFIX=""
COMMIT_SUFFIX=""

# Agent identification (optional override)
AGENT_TYPE_OVERRIDE=""

# Custom scopes (space-separated)
CUSTOM_SCOPES="core services components tests docs"

# Date validation settings
VALIDATE_DATES="true"
ALLOW_PAST_DATES="true"
ALLOW_FUTURE_DAYS="7"  # Allow up to 7 days in the future
MAX_PAST_DAYS="7"      # Flag dates older than 7 days (good for new projects)
MAX_AUTHOR_DAYS="7"    # Flag @author dates older than 7 days
EOF
    echo "Created .commit-config.sample - copy to .commit-config to customize"
}

# Validate configuration
validate_config() {
    detect_project_config
    
    echo "Current Configuration:"
    echo "  Project Tag: $PROJECT_TAG"
    echo "  Project Name: $PROJECT_NAME"
    echo "  Agent Context: $AGENT_CONTEXT"
    echo "  Current Package: $(get_current_package)"
    echo "  Available Scopes: $(get_project_scopes)"
    echo "  Date Validation:"
    echo "    - Allow Future Days: ${ALLOW_FUTURE_DAYS:-7}"
    echo "    - Max Past Days: ${MAX_PAST_DAYS:-7}"
    echo "    - Max Author Days: ${MAX_AUTHOR_DAYS:-7}"
}

# Command handling
case "${1:-}" in
    "detect")
        detect_project_config
        validate_config
        ;;
    "footer")
        get_commit_footer "$2" "$3"
        ;;
    "scopes")
        get_project_scopes
        ;;
    "suggest-scope")
        suggest_commit_scope "$2"
        ;;
    "validate")
        validate_config
        ;;
    "create-sample")
        create_sample_config
        ;;
    "package")
        get_current_package
        ;;
    *)
        echo "Usage: $0 {detect|footer|scopes|suggest-scope|validate|create-sample|package}"
        exit 1
        ;;
esac 