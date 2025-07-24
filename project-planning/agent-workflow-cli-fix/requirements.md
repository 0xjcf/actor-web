# Project Requirements: Agent Workflow CLI Fix

## UPDATED Problem Statement - MAJOR ARCHITECTURAL DISCOVERY

### ✅ **Phase 1 Complete**: ES Module Issue Resolved
The original ES module error has been **successfully fixed**:
- ❌ **Before**: `ReferenceError: require is not defined in ES module scope`
- ✅ **After**: CLI executes without ES module errors, basic commands work

### ✅ **Phase 2 Complete**: Actor System Integration Fixed  
Guardian actor and system initialization issues have been **successfully resolved**:
- ❌ **Before**: Guardian actor missing, dead letter queue errors
- ✅ **After**: Actor system initializes properly, no dead letter queue errors

### ❌ **PHASE 3 CRITICAL DISCOVERY**: Entire CLI Violates Pure Actor Model

**MAJOR ARCHITECTURAL VIOLATION DISCOVERED**: All CLI commands use **forbidden subscription patterns** instead of pure actor model:

**❌ Forbidden Patterns Found Everywhere:**
```typescript
// All commands use these FORBIDDEN patterns:
const unsubscribe = subscribeToEvent(this.actor, 'GIT_REPO_STATUS_CHANGED', (event) => {
  // subscription-based event handling
});

class SaveWorkflowHandler {
  // Class-based handlers instead of pure functions
}

// Complex subscription orchestration
const changesPromise = new Promise((resolve) => {
  const unsubscribe = subscribeToEvent(actor, 'EVENT_TYPE', callback);
});
```

**✅ Required Pure Actor Model Patterns:**
```typescript
// CORRECT: Use ask/tell patterns only
const repoStatus = await gitActor.ask<{ isGitRepo: boolean }>({
  type: 'REQUEST_STATUS'
});

// CORRECT: Simple function-based commands
export async function saveCommand() {
  // Direct ask/tell, no subscriptions, no classes
}
```

**Commands That Need Complete Refactoring:**
- ❌ `save.ts` - **FIXED** ✅ Uses pure ask/tell patterns now
- ❌ `ship.ts` - Uses subscriptions, classes, complex handlers  
- ❌ `status.ts` - Uses subscriptions and handler classes
- ❌ `validate.ts` - Uses subscriptions and workflow handlers
- ❌ `commit-enhanced.ts` - Uses subscriptions and handler classes
- ❌ `advanced-git.ts` - Uses subscriptions and workflow handlers
- ❌ `git-actor-helpers.ts` - **DELETE** Entire file violates pure actor model

## Revised Success Criteria

### ✅ **Phase 1: ES Module Fix** - ACHIEVED
- ✅ **ES module compatibility** - No `require()` usage in ES module context
- ✅ **TypeScript compilation** - Clean build with no errors  
- ✅ **Package.json loading** - Proper ES module import of package metadata
- ✅ **Basic CLI commands** - `--version`, `--help` work perfectly
- ✅ **Integration tests pass** - All ES module compatibility tests passing

### ✅ **Phase 2: Actor System Fix** - ACHIEVED  
- ✅ **Actor system properly initialized** - System guardian actor operational
- ✅ **No dead letter queue errors** - All actor messages properly routed
- ✅ **CLI actor system working** - Commands can create and communicate with actors

### ❌ **Phase 3: Pure Actor Model Compliance** - CRITICAL PRIORITY
- ✅ **Save command pure actor model** - **COMPLETED** Uses only ask/tell patterns
- [ ] **Ship command pure actor model** - Refactor to ask/tell, remove subscriptions
- [ ] **Status command pure actor model** - Refactor to ask/tell, remove subscriptions  
- [ ] **Validate command pure actor model** - Refactor to ask/tell, remove subscriptions
- [ ] **Commit-enhanced command pure actor model** - Refactor to ask/tell, remove subscriptions
- [ ] **Advanced-git commands pure actor model** - Refactor to ask/tell, remove subscriptions
- [ ] **Remove forbidden helper functions** - Delete `git-actor-helpers.ts` subscription functions
- [ ] **All CLI commands work end-to-end** - No hanging, proper completion
- [ ] **Zero subscription patterns** - Only ask/tell communication allowed
- [ ] **Zero handler classes** - Only pure functions allowed
- [ ] **FRAMEWORK-STANDARD compliance** - Follows all pure actor model rules

## Expanded Constraints

### Technical Constraints
- **Node.js ES Modules**: ✅ **ACHIEVED** - Works with ES module system (`"type": "module"`)
- **TypeScript**: ✅ **ACHIEVED** - Maintains TypeScript compilation and type safety
- **Actor System Integration**: ✅ **ACHIEVED** - Proper guardian actor initialization and supervision
- **🔴 PURE ACTOR MODEL COMPLIANCE**: **CRITICAL** - Must eliminate ALL forbidden patterns:
  - ❌ **NO subscriptions** - No `subscribeToEvent()` patterns allowed
  - ❌ **NO handler classes** - No `SaveWorkflowHandler` or similar classes
  - ❌ **NO complex promise orchestration** - Only simple ask/tell patterns
  - ❌ **NO event-driven workflows** - Only request/response patterns
  - ✅ **ONLY ask/tell patterns** - `actor.ask()` for request/response, `actor.send()` for fire-and-forget
- **Message Format Standards**: All interactions must use proper ActorMessage format
- **Existing API**: Cannot break existing command interfaces or scripts
- **Package Dependencies**: Must work with current package.json workspace structure

### Timeline Constraints - SIGNIFICANTLY EXPANDED  
- **High Priority**: Still blocking development workflow
- **Extended Timeline**: **Original estimate 2-3 days expanded to 7-10 days** due to pure actor model refactoring
- **Architectural Compliance**: Framework integrity depends on pure actor model compliance

### Resource Constraints
- **Single Developer**: Implementation by current agent/developer  
- **Pure Actor Model Expertise**: **CRITICAL** - Must understand and implement pure actor patterns correctly
- **Testing Environment**: Must test in actual monorepo environment with full actor system
- **Framework Standards**: Must follow @FRAMEWORK-STANDARD.mdc rules strictly

## Updated Stakeholder Needs

### Primary Stakeholders  
- **Framework Developers**: Need **fully functional** CLI commands that follow pure actor model
- **Agent Workflow System**: Requires **complete pure actor model compliance** for framework integrity
- **Project Maintenance**: Needs reliable workflow tooling with **zero architectural violations**

### Secondary Stakeholders
- **Future Contributors**: Should have pure actor model examples in CLI
- **Framework Users**: Need to see proper actor patterns implemented correctly
- **Documentation**: Needs accurate pure actor model examples

## Non-Requirements - UPDATED

### Explicitly Out of Scope
- **CLI Feature Additions** - This is purely a bug fix and architectural compliance, no new functionality
- **Performance Optimization** - Focus on functionality and compliance, not performance improvements
- **UI/UX Changes** - Keep existing command interface exactly the same
- **Configuration Changes** - Don't modify how users invoke commands (`pnpm aw:save`)
- **Alternative Workflow Tools** - Not replacing the CLI, just fixing it
- **Actor Model Redesign** - Work within existing actor architecture, implement it correctly

### Future Considerations (Not This Project)
- Enhanced error messages and user experience
- Additional CLI commands or features  
- Integration with other development tools
- Performance optimizations

## Risk Assessment - UPDATED

### High Risk ⚠️
- **Massive Scope Expansion**: Pure actor model refactoring affects ALL CLI commands
- **Timeline Extension**: Architectural compliance significantly increases implementation time
- **Framework Integrity**: Leaving subscription patterns would violate core framework principles
- **Complex Refactoring**: Each command needs complete rewrite, not just fixes

### Medium Risk
- **Breaking Changes**: Extensive refactoring could introduce new bugs
- **Actor Message Format**: Commands may need message format adjustments
- **Testing Complexity**: Need to verify all commands work with pure actor patterns

### Low Risk  
- **Command Interface**: Core command signatures will remain stable
- **ES Module Compatibility**: This phase is complete and stable
- **Actor System Foundation**: Guardian and system actors are now working properly

## Updated Acceptance Criteria

### Functional Requirements
1. **Complete Command Execution**: All `aw:*` commands execute and complete successfully
2. **Pure Actor Model Compliance**: Zero subscription patterns, only ask/tell communication
3. **Git Integration**: Save and ship commands properly create commits and push changes
4. **Error Handling**: Meaningful error messages for actual failures

### Technical Requirements  
1. **ES Module Compliance**: ✅ **ACHIEVED** - All imports use `import` syntax, no `require()` calls
2. **TypeScript Compilation**: ✅ **ACHIEVED** - Clean `tsc` build with no errors or warnings
3. **Actor System Integration**: ✅ **ACHIEVED** - Proper guardian actor initialization and supervision
4. **Pure Actor Model Compliance**: **CRITICAL** - Zero subscription patterns, only ask/tell
5. **Message Format Compliance**: All events follow standardized ActorMessage format
6. **Node.js Compatibility**: Works with Node.js 18+ ES module system

### Quality Requirements
1. **Zero Regression**: All previously working functionality must continue to work
2. **End-to-End Functionality**: Commands behave completely, not just partially  
3. **Proper Testing**: Integration tests verify all CLI commands work from start to finish
4. **Framework Standards Compliance**: Follows @FRAMEWORK-STANDARD.mdc rules exactly
5. **Zero Forbidden Patterns**: No subscriptions, no handler classes, no complex event orchestration

---

**Priority**: 🔥 **CRITICAL** - Framework integrity violation, blocks development workflow  
**Complexity**: 🔴 **VERY HIGH** - Complete architectural refactoring of all CLI commands required  
**Timeline**: ⏰ **7-10 days** - Comprehensive pure actor model implementation across entire CLI 