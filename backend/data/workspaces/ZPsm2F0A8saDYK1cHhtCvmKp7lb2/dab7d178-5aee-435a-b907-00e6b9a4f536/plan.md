plan_content = '''# AI Project Plan Template

## 1. Project Objectives
- Define clear, measurable goals.

## 2. Scope & Success Criteria
- What is in scope? What are the success metrics?

## 3. Timeline & Milestones
| Phase | Milestone | Owner | Target Date |
|-------|-----------|-------|------------|
| Discovery | Requirements gathered |  | |
| Data Prep | Data pipeline ready |  | |
| Modeling | Baseline model built |  | |
| Evaluation | Performance validated |  | |
| Deployment | Production rollout |  | |

## 4. Team & Resources
- Roles needed (Data Engineer, ML Engineer, PM, etc.)
- Tooling stack (cloud, libraries, CI/CD)

## 5. Risk & Mitigation
- Data quality issues → early data profiling
- Model drift → monitoring plan

## 6. Deliverables
- Technical documentation
- Model artifacts
- Deployment scripts
- KPI dashboard
'''
with open('plan.md', 'w') as f:
    f.write(plan_content)
print('plan.md created')