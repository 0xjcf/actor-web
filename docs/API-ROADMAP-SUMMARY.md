# API Roadmap Summary - Key Insights from Research

## 🔍 What We Learned from the Research

### 1. **Message Plan DSL** (vNext Design)
The research revealed a revolutionary approach to simplify actor communication:
- **Problem**: Dual-write bugs from separate `machine.send()` + `emit()` calls
- **Solution**: Return a single message plan that handles everything atomically
- **Benefits**: 50% less boilerplate, crash-safe, exactly-once delivery

### 2. **Location Transparency** (Cross-Context Design)
The framework must support actors running anywhere:
- **URI Scheme**: `actor://sw/*`, `actor://worker/*`, `actor://cloud/*`
- **Transport Layer**: Framework handles routing (postMessage, WebSocket, etc.)
- **Developer Experience**: Same code works everywhere

### 3. **Behavior vs Actor** (Actor Model Research)
Clear distinction between identity and behavior:
- **Actor**: Has identity and mailbox (the "who")
- **Behavior**: Message handler (the "what")
- **Decision**: Use XState for behavior changes, not explicit `become` primitive

### 4. **API Surface Recommendations** (API Research)
The current API exposes too much:
- **Core API**: Should be ~15KB with only essential exports
- **Advanced Features**: Move to separate packages (virtual, persistence, security, AI)
- **Documentation**: Progressive disclosure - start simple, add complexity as needed

## 🎯 Key Decisions for API Roadmap

### Public API (Core)
- Actor creation and lifecycle
- Message Plan DSL
- Basic component integration
- Essential types only

### Enterprise API (Paid/Advanced)
- Virtual actors (Orleans-style)
- Event sourcing & persistence
- Capability-based security
- AI agent patterns
- Distributed coordination

### Migration Strategy
1. **Soft Launch**: Both APIs side-by-side
2. **Deprecation**: Clear warnings and migration tools
3. **Clean Break**: Old API in legacy package
4. **v1.0 Stability**: No breaking changes after release

## 📊 Success Metrics

### Developer Experience
- 5-minute quick start possible
- 50% less code for common tasks
- Zero configuration for basic usage
- Progressive enhancement for advanced needs

### Technical Goals
- Core <15KB gzipped
- Zero dependencies
- 100% type safety
- Works everywhere (browser, Node, Edge)

## 🚀 Next Steps

1. **Implement Message Plan DSL** - High priority for Phase 2.4
2. **Split packages** - Create modular architecture
3. **Document migration path** - Help users transition
4. **Enterprise roadmap** - Define commercial offerings 