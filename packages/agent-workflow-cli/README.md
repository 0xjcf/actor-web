# Agent Workflow CLI - Prototype

> **Phase 1 Research Prototype** - Testing technical feasibility of packaging our agent-centric workflow

## 🎯 Research Goals

This prototype validates the technical feasibility from our [research plan](../../docs/NPM-PACKAGE-RESEARCH.md):

### Week 1-2: Technical Spike
- [ ] **CLI Framework Testing** - Compare Commander.js vs Oclif vs others
- [ ] **Script Extraction** - Port our bash scripts to Node.js
- [ ] **Actor Model POC** - Test message-passing architecture
- [ ] **Cross-platform** - Verify Git worktree operations work everywhere

### Week 3: Market Validation  
- [ ] **Developer Interviews** - 10-15 interviews about Git workflow pain points
- [ ] **Community Research** - Analyze competitor GitHub issues and forums
- [ ] **Early Adopter ID** - Find 5+ people willing to try alpha

## 🧪 Current Prototype

```bash
# Install dependencies (from root - pnpm workspace)
pnpm install

# Test CLI commands (TODO implementations)
pnpm --filter @agent-workflow/cli dev --help
pnpm --filter @agent-workflow/cli dev init --agents 3
pnpm --filter @agent-workflow/cli dev status
pnpm --filter @agent-workflow/cli dev sync
pnpm --filter @agent-workflow/cli dev validate  
pnpm --filter @agent-workflow/cli dev ship

# Alternative: From package directory
cd packages/agent-workflow-cli
pnpm dev --help
pnpm dev init --agents 3
```

## 🔬 Research Findings

### CLI Framework Comparison
- **Commander.js**: ✅ Simple, mature, TypeScript support
- **Oclif**: ⏳ Testing plugin system capabilities 
- **Yargs**: ⏳ Testing complex argument parsing

### Script Extraction Progress
- [x] CLI structure setup
- [ ] Extract `setup-agent-worktrees.sh` → `init` command
- [ ] Extract `agent-workflow.sh` → multiple commands
- [ ] Extract `worktree-maintenance.sh` → `health` command

### Actor Model Experiments
- [ ] FileWatcher Actor → Validation Actor message passing
- [ ] Git Operations Actor for worktree management
- [ ] Supervisor Actor for error recovery

## 📊 Success Criteria Tracking

### Technical Feasibility ✅/❌
- [ ] Can extract all bash script functionality to Node.js
- [ ] Cross-platform Git worktree operations work
- [ ] Actor model adds value without complexity overhead
- [ ] CLI framework supports plugin architecture

### Market Demand ✅/❌  
- [ ] 5+ developers express strong interest
- [ ] Clear pain points identified that competitors don't solve
- [ ] Early adopters willing to test alpha version

### Competitive Gap ✅/❌
- [ ] No existing tool solves multi-agent coordination
- [ ] Git worktree approach unique vs monorepo tools
- [ ] Smart validation superior to current solutions

### Resource Feasibility ✅/❌
- [ ] Team can build MVP in 6-8 weeks
- [ ] Clear path from prototype to production package

## 🚀 Next Steps

**If Phase 1 succeeds:**
1. Create dedicated `agent-workflow-cli` repository
2. Implement full CLI with extracted script logic  
3. Add actor model architecture
4. Begin community alpha testing

**If Phase 1 fails:**
1. Document learnings and blockers
2. Consider pivoting approach or shelving project
3. Focus resources on Actor-Web Framework instead

---

**This prototype is part of the Actor-Web ecosystem but designed as a standalone tool for any development team.** 