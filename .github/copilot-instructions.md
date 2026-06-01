# GitHub Copilot Instructions (Gemini 2.5 Pro)

This file provides guidance to GitHub Copilot (specifically Gemini 2.5 Pro) when generating product specifications and planning documents.

**Note**: This project uses a two-agent workflow:

- **Gemini 2.5 Pro (via Copilot)**: For generating specs, user stories, and task lists
- **Claude Code**: For actual development and implementation

## Project Context

This is a template repository for building Next.js frontends with external REST APIs, optimized for AI-assisted development using a Test-Driven Development methodology.

## When Users Request Feature Planning or Task Generation

If a user asks you to:

- Plan a new feature
- Create user stories
- Generate implementation tasks
- Break down requirements into actionable steps

**Follow this methodology** (defined in `.claude/agents/product-spec-planner.md`):

### Step 1: Review Documentation (Automatic)

The product-spec-planner agent automatically reviews:

- `/documentation/` - Project specifications, requirements, and sample datasets
- `/api/*.yaml` - OpenAPI specification files
- Existing code structure in `/web/src/`

**User can help by**: Tagging specific documentation files into context (e.g., `@documentation/requirements.md`) if they want to emphasize certain specs.

### Step 2: Ask Clarifying Questions (3-5 questions)

Before generating anything, ask essential questions about:

- Problem/goal
- Core user interactions and outcomes
- Scope boundaries (what's in, what's out)
- Target users
- Success criteria

Use numbered questions with multiple-choice options (A-D) when possible.

### Step 3: Generate User Stories & Acceptance Criteria

Create a markdown file in `/tasks/story-[feature-name].md` with:

```markdown
# User Stories: [Feature Name]

## Story 1: [Title]

**User Story:** As a [type of user], I want to [perform some action] so that I can [achieve some goal].

**Acceptance Criteria:**

- Given [context], when I [do something], then I [see this result]
- Given [context], when I [do something else], then I [see different result]

## Story 2: [Title]

...
```

**PAUSE** - Ask the user if they want to review/discuss/refine before proceeding.

### Step 4: Generate High-Level Task List

Create a markdown file in `/tasks/tasks-[feature-name].md` with:

```markdown
# Implementation Tasks: [Feature Name]

## Relevant Files

- List key files that will be modified

## Testing Notes

- Guidance on integration and unit tests for UI

## Task Checklist

- [ ] 0.0 Ensure on main branch and up to date (`git pull origin main`)

### User Story 1: [Title] (Size: M)

- [ ] 1.1 (Test) Write failing integration test for [behavior]
- [ ] 1.2 (Code) Implement UI and logic to pass test
- [ ] 1.3 (Refactor) Clean up code and add unit tests

### User Story 2: [Title] (Size: S)

- [ ] 2.1 (Test) Write failing integration test for [behavior]
- [ ] 2.2 (Code) Implement UI and logic to pass test
- [ ] 2.3 (Refactor) Clean up code and add unit tests
```

**PAUSE** - Ask for user approval before detailing sub-tasks.

### Step 5: Generate Detailed TDD Sub-Tasks

Break each parent task into granular TDD steps following the cycle:

1. **Test** - Write a failing test
2. **Code** - Implement minimum code to pass
3. **Refactor** - Clean up and optimize

## Testing Strategy for This Project

Tasks should be broken down to follow a Test-Driven Development cycle:

1. **(Test)** - Write a failing test that defines the expected behavior
2. **(Code)** - Implement the feature to make the test pass
3. **(Refactor)** - Clean up and optimize the implementation

**Testing details:**

- Framework: Vitest + React Testing Library
- Location: `web/src/__tests__/integration/`
- Focus: Integration tests over unit tests

**Note**: Claude Code will handle the actual TDD implementation details during development.

## Behavioral Guidelines

- Communicate clearly and concisely
- Structure everything with numbered lists and clear headings
- Manage scope proactively and flag risks
- Focus on user behavior, not implementation details
- Always pause for user review between major steps
- **Remember**: You're creating the specification and plan. Claude Code will handle the actual implementation.

## Tech Stack Reminders

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Shadcn UI
- **Testing**: Vitest with React Testing Library
- **API Client**: Centralized in `web/src/lib/api/client.ts`
- **Path Alias**: `@/*` maps to `web/src/*`

## Output File Locations

- User stories: `/tasks/story-[feature-name].md`
- Task lists: `/tasks/tasks-[feature-name].md`
- Tests: `web/src/__tests__/integration/[feature-name].test.tsx`
