# Supervisor API Design Note

## Preferred Pattern (Erlang/Elixir Style)

The framework should support the declarative supervisor pattern similar to Erlang/Elixir OTP:

```typescript
const supervisor = createSupervisor({
  strategy: 'one-for-one',  // or 'one-for-all', 'rest-for-one'
  children: [
    { id: 'worker-1', behavior: workerBehavior },
    { id: 'worker-2', behavior: workerBehavior },
    { id: 'db-actor', behavior: databaseActor }
  ],
  maxRestarts: 3,
  restartWindow: 60000 // 1 minute
});
```

## Why This Pattern is Better

1. **Declarative** - Define the supervision tree structure upfront
2. **Erlang/Elixir Compatible** - Follows OTP supervisor patterns exactly
3. **Cleaner** - No imperative calls to `supervise()` needed
4. **Type-Safe** - Can infer types from behaviors array
5. **Atomic** - Entire supervision tree starts together

## Erlang/Elixir Comparison

In Erlang:
```erlang
init([]) ->
    SupFlags = #{strategy => one_for_one,
                 intensity => 3,
                 period => 60},
    ChildSpecs = [#{id => worker1,
                    start => {worker, start_link, []},
                    restart => permanent},
                  #{id => worker2,
                    start => {worker, start_link, []},
                    restart => permanent}],
    {ok, {SupFlags, ChildSpecs}}.
```

In Elixir:
```elixir
def init(_) do
  children = [
    {Worker, name: :worker_1},
    {Worker, name: :worker_2},
    {DatabaseActor, name: :database}
  ]

  opts = [strategy: :one_for_one, max_restarts: 3, max_seconds: 60]
  Supervisor.init(children, opts)
end
```

## Implementation Notes

The `createSupervisor` function should:
1. Return a supervisor behavior that can be spawned
2. Automatically spawn child actors when supervisor starts
3. Handle restart strategies according to OTP patterns
4. Maintain supervision tree hierarchy

## Usage in Actor System

```typescript
// The supervisor itself is an actor
const supervisorActor = createSupervisor({
  strategy: 'one-for-one',
  children: [
    { id: 'worker-1', behavior: workerBehavior },
    { id: 'worker-2', behavior: workerBehavior }
  ]
});

// Spawn the supervisor (which spawns its children)
const supervisor = await system.spawn(supervisorActor, { id: 'my-supervisor' });
```

This pattern maintains pure actor model compliance while providing familiar OTP semantics.