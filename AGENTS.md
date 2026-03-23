# AGENTS.md

## Mission
Build and maintain a production quality local web application that aggregates publicly available true studio apartment listings in the Canton of Zurich and displays them in a polished frontend with original source links.

## Non negotiable product rules
- Only include listings that are true self contained studios
- A valid studio must have a private bathroom and private kitchen or kitchenette
- Exclude WG, shared apartments, roommate offers, single rooms, and listings with shared facilities
- Only include listings verified to be inside the Canton of Zurich
- Always preserve and display the original source URL
- Prefer precision over recall when classification is uncertain

## Engineering rules
- Use TypeScript unless there is a strong technical reason not to
- Keep source adapters separate from normalization logic
- Keep normalization separate from filtering logic
- Keep filtering separate from presentation
- Use clean modular file structure
- No placeholder code
- No TODO comments
- No mock APIs
- No invented external interfaces
- Do not claim a source works if it is blocked or unstable
- Fail gracefully per source and continue with working sources
- Add logging for extraction failures
- Add caching or local persistence to reduce repeated upstream requests

## Expected workflow
1. Inspect existing files before editing
2. Propose or infer a coherent architecture
3. Build shared types and normalized schema first
4. Build source adapters next
5. Build classification and canton validation logic next
6. Add deduplication and persistence
7. Build backend APIs
8. Build frontend
9. Validate locally
10. Update README with exact run instructions and limitations

## Data quality rules
- Ambiguous listings must be excluded
- Ambiguous geography must be excluded
- Deduplicate aggressively but safely
- Never drop the original listing URL
- Track source name and scrape timestamp for every listing

## UI rules
- The original source link must be prominent
- Show title, price, municipality, size, source, and image if available
- Responsive design is required
- Empty states and error states must be clear and useful

## Output rules
When finishing a task, summarize:
- what you changed
- what you verified
- what remains limited due to source constraints