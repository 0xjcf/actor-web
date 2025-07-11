#!/bin/bash

# Date Synchronization Utilities for Actor Web Architecture
# Ensures all agents use consistent, current dates

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get current date in various formats
get_current_date() {
    date +"%Y-%m-%d"
}

get_current_datetime() {
    date +"%Y-%m-%d %H:%M:%S %Z"
}

get_current_iso() {
    date -u +"%Y-%m-%dT%H:%M:%SZ"
}

get_current_timestamp() {
    date +"%Y%m%d_%H%M%S"
}

# Validate date format (YYYY-MM-DD)
validate_date_format() {
    local date_string="$1"
    if [[ $date_string =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
        return 0
    else
        return 1
    fi
}

# Check if a date is in the future or past compared to today
check_date_validity() {
    local date_string="$1"
    local current_date=$(get_current_date)
    
    if [ "$date_string" = "$current_date" ]; then
        echo "current"
    elif [[ "$date_string" > "$current_date" ]]; then
        echo "future"
    else
        echo "past"
    fi
}

# Check if a date is problematic (needs fixing)
is_problematic_date() {
    local date_string="$1"
    local file_path="$2"
    local line_content="$3"
    
    local current_date=$(get_current_date)
    local date_status=$(check_date_validity "$date_string")
    
    # Load configuration if available
    local allow_past_dates="${ALLOW_PAST_DATES:-true}"
    local allow_future_days="${ALLOW_FUTURE_DAYS:-7}"
    local max_past_days="${MAX_PAST_DAYS:-7}"  # Default to 7 days for new projects
    local max_author_days="${MAX_AUTHOR_DAYS:-7}"  # Default to 7 days for @author tags
    
    # Check for legitimate contexts where dates should not be flagged
    if [[ "$line_content" =~ (version|release|changelog|history|created|published|updated) ]]; then
        # These are likely legitimate historical dates
        return 1  # Not problematic
    fi
    
    # Check for very old dates (likely copy-paste errors)
    # For a new project, anything older than configured threshold is suspicious
    local threshold_date=$(date -d "${max_past_days} days ago" +"%Y-%m-%d")
    if [[ "$date_string" < "$threshold_date" ]]; then
        return 0  # Problematic - too old for project
    fi
    
    # Check for future dates
    if [ "$date_status" = "future" ]; then
        # Calculate days in the future
        local days_diff=$(( ($(date -d "$date_string" +%s) - $(date -d "$current_date" +%s)) / 86400 ))
        if [ "$days_diff" -gt "$allow_future_days" ]; then
            return 0  # Problematic - too far in future
        fi
    fi
    
    # Check for past dates in @author tags (likely hardcoded)
    if [[ "$line_content" =~ @author.*- ]]; then
        local days_diff=$(( ($(date -d "$current_date" +%s) - $(date -d "$date_string" +%s)) / 86400 ))
        if [ "$days_diff" -gt "$max_author_days" ]; then
            return 0  # Problematic - @author date too old for active project
        fi
    fi
    
    return 1  # Not problematic
}

# Fix dates in documentation files
fix_documentation_dates() {
    local file_path="$1"
    local current_date=$(get_current_date)
    
    if [ ! -f "$file_path" ]; then
        echo -e "${RED}❌ File not found: $file_path${NC}"
        return 1
    fi
    
    echo -e "${BLUE}🔍 Checking dates in: $file_path${NC}"
    
    # Find problematic dates using smart detection
    local problematic_dates=$(grep -n "202[0-9]-[0-9][0-9]-[0-9][0-9]" "$file_path" | while read line; do
        line_num=$(echo "$line" | cut -d: -f1)
        line_content=$(echo "$line" | cut -d: -f2-)
        date_found=$(echo "$line" | grep -o "202[0-9]-[0-9][0-9]-[0-9][0-9]")
        
        if is_problematic_date "$date_found" "$file_path" "$line_content"; then
            date_status=$(check_date_validity "$date_found")
            echo "$line_num:$date_found:$date_status"
        fi
    done)
    
    if [ -n "$problematic_dates" ]; then
        echo -e "${YELLOW}⚠️  Found problematic dates:${NC}"
        echo "$problematic_dates" | while IFS=: read line_num date_found status; do
            echo -e "  Line $line_num: $date_found (${status})"
        done
        
        read -p "Would you like to fix these dates to current date ($current_date)? (y/N) " -n 1 -r
        echo
        
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            # Create backup
            cp "$file_path" "${file_path}.backup"
            echo -e "${BLUE}📋 Created backup: ${file_path}.backup${NC}"
            
            # Fix the dates
            echo "$problematic_dates" | while IFS=: read line_num date_found status; do
                sed -i.tmp "s/$date_found/$current_date/g" "$file_path"
                echo -e "${GREEN}✅ Fixed line $line_num: $date_found → $current_date${NC}"
            done
            
            # Remove temp file
            rm -f "${file_path}.tmp"
            
            echo -e "${GREEN}✅ Fixed dates in $file_path${NC}"
        else
            echo -e "${YELLOW}⏭️  Skipped fixing dates in $file_path${NC}"
        fi
    else
        echo -e "${GREEN}✅ No problematic dates found in $file_path${NC}"
    fi
}

# Scan all documentation for date issues
scan_all_docs() {
    echo -e "${BLUE}🔍 Scanning all documentation for date issues...${NC}"
    
    # Find all markdown files
    local doc_files=$(find docs/ src/ -name "*.md" 2>/dev/null)
    local issues_found=0
    
    while IFS= read -r file; do
        if [ -f "$file" ]; then
            local file_issues=$(grep -o "202[0-9]-[0-9][0-9]-[0-9][0-9]" "$file" 2>/dev/null | wc -l | tr -d ' ')
            if [ "$file_issues" -gt 0 ]; then
                echo -e "${YELLOW}📄 $file: $file_issues date(s) found${NC}"
                issues_found=$((issues_found + 1))
            fi
        fi
    done <<< "$doc_files"
    
    if [ "$issues_found" -eq 0 ]; then
        echo -e "${GREEN}✅ No documentation files with dates found${NC}"
    else
        echo -e "${BLUE}💡 Run 'fix_documentation_dates <file>' to fix specific files${NC}"
        echo -e "${BLUE}💡 Or use 'fix_all_docs' to fix all documentation${NC}"
    fi
}

# Fix all documentation files
fix_all_docs() {
    echo -e "${BLUE}🔧 Fixing dates in all documentation files...${NC}"
    
    local doc_files=$(find docs/ src/ -name "*.md" 2>/dev/null)
    local fixed_count=0
    
    while IFS= read -r file; do
        if [ -f "$file" ]; then
            local has_dates=$(grep -o "202[0-9]-[0-9][0-9]-[0-9][0-9]" "$file" 2>/dev/null | wc -l | tr -d ' ')
            if [ "$has_dates" -gt 0 ]; then
                echo -e "${BLUE}Processing: $file${NC}"
                fix_documentation_dates "$file"
                fixed_count=$((fixed_count + 1))
            fi
        fi
    done <<< "$doc_files"
    
    if [ "$fixed_count" -eq 0 ]; then
        echo -e "${GREEN}✅ No files needed fixing${NC}"
    else
        echo -e "${GREEN}✅ Processed $fixed_count files${NC}"
    fi
}

# Update file header dates
update_file_header() {
    local file_path="$1"
    local agent_name="$2"
    local current_date=$(get_current_date)
    
    if [ ! -f "$file_path" ]; then
        echo -e "${RED}❌ File not found: $file_path${NC}"
        return 1
    fi
    
    # Update @author lines with current date
    if grep -q "@author" "$file_path"; then
        sed -i.bak "s/@author \(.*\) - [0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}/@author \1 - $current_date/" "$file_path"
        rm -f "${file_path}.bak"
        echo -e "${GREEN}✅ Updated header date in $file_path${NC}"
    fi
}

# Usage information
usage() {
    echo -e "${BLUE}📅 Date Synchronization Utilities${NC}"
    echo -e "${BLUE}=================================${NC}"
    echo ""
    echo "Usage: $0 <command> [arguments]"
    echo ""
    echo "Commands:"
    echo -e "  ${GREEN}current${NC}              - Get current date (YYYY-MM-DD)"
    echo -e "  ${GREEN}datetime${NC}             - Get current datetime with timezone"
    echo -e "  ${GREEN}iso${NC}                  - Get current ISO datetime"
    echo -e "  ${GREEN}timestamp${NC}            - Get current timestamp (YYYYMMDD_HHMMSS)"
    echo -e "  ${GREEN}validate <date>${NC}      - Validate date format (YYYY-MM-DD)"
    echo -e "  ${GREEN}check <date>${NC}         - Check if date is current/past/future"
    echo -e "  ${GREEN}fix <file>${NC}           - Fix dates in specific file"
    echo -e "  ${GREEN}scan${NC}                 - Scan all docs for date issues"
    echo -e "  ${GREEN}fix-all${NC}              - Fix dates in all documentation"
    echo -e "  ${GREEN}update-header <file> <agent>${NC} - Update file header with current date"
    echo ""
    echo "Examples:"
    echo "  $0 current                    # 2025-07-11"
    echo "  $0 fix docs/README.md         # Fix dates in README"
    echo "  $0 scan                       # Scan all docs"
}

# Command handling
case "${1:-}" in
    "current")
        get_current_date
        ;;
    "datetime")
        get_current_datetime
        ;;
    "iso")
        get_current_iso
        ;;
    "timestamp")
        get_current_timestamp
        ;;
    "validate")
        if [ -z "$2" ]; then
            echo -e "${RED}❌ Please provide a date to validate${NC}"
            exit 1
        fi
        if validate_date_format "$2"; then
            echo -e "${GREEN}✅ Valid date format: $2${NC}"
        else
            echo -e "${RED}❌ Invalid date format: $2 (expected YYYY-MM-DD)${NC}"
            exit 1
        fi
        ;;
    "check")
        if [ -z "$2" ]; then
            echo -e "${RED}❌ Please provide a date to check${NC}"
            exit 1
        fi
        result=$(check_date_validity "$2")
        case "$result" in
            "current")
                echo -e "${GREEN}✅ Date is current: $2${NC}"
                ;;
            "future")
                echo -e "${YELLOW}⚠️  Date is in the future: $2${NC}"
                ;;
            "past")
                echo -e "${BLUE}ℹ️  Date is in the past: $2${NC}"
                ;;
        esac
        ;;
    "fix")
        if [ -z "$2" ]; then
            echo -e "${RED}❌ Please provide a file to fix${NC}"
            exit 1
        fi
        fix_documentation_dates "$2"
        ;;
    "scan")
        scan_all_docs
        ;;
    "fix-all")
        fix_all_docs
        ;;
    "update-header")
        if [ -z "$2" ] || [ -z "$3" ]; then
            echo -e "${RED}❌ Please provide file path and agent name${NC}"
            exit 1
        fi
        update_file_header "$2" "$3"
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