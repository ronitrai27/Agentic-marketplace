# lead agent 
first of all why u created for no webzites - it was just an tiny 1 example 
2. in leads i cant find ny email 
sites -> may are of insta or other not the coffee webistes ( wrong data in between)
owner name - not available for any !!
and then 6 jwellery shops no website - u r giving me webistes !! - agent knows that he needs shops that dosent have webistes ?
where is critic agent to verify all before giving that reponse which is total waste ?
and why jev result is 95% ? even nothing matches?

u did all wrong examples to jev !!

what if i ask 
Find 10 AI startups in India with their company name and website.
Find 20 SaaS companies in the USA and return their name, website, industry, and LinkedIn URL.
Find 50 US-based SaaS companies with 10–100 employees that are actively hiring software developers. Return company name, website, employee range, careers page, and evidence source.

your schema even dosent match this - everything is hardcoded ! no use total shit !!!!
remove everything every example!!

your whole logic is wrong !

====
How Each Part of the New Logic Works
1. Dynamic Schema Synthesis (No Hardcoded Models)
Instead of hardcoding fixed fields like phone, rating, address, the agent first parses the user prompt into a Lead Specification:

Target Count: (e.g. 10, 20, 50).
Required Fields: (e.g. ["company_name", "website", "employee_range", "careers_url", "hiring_evidence"]).
Hard Constraints / Filters:
Positive constraints: industry == "SaaS", location == "USA", hiring == "software developer".
Negative constraints: has_website == false (if user explicitly demanded it), employees <= 100.
Each lead is stored as a dynamic dictionary dict[str, Any] matching exactly what the user asked for, plus evidence source URL.

2. Multi-Strategy Search & Inspection (SerpAPI + Fast Targeted Fetch)
To find hiring status, employee size, or actual emails:

Search Dorking: Formulates smart SerpAPI web searches:
For hiring: "{company} careers software engineer" or "SaaS companies hiring software developers USA site:lever.co OR site:greenhouse.io".
For LinkedIn / size: "site:linkedin.com/company/ {company}".
Targeted Header/Footer Fetcher: Pulls only the /careers, /about, or /contact subpage (capped at 1,500 chars) to get the ground-truth evidence.
3. The Strict Critic Node (gpt-5.1-mini)
The Critic receives the candidate lead and the user's explicit constraints. It answers:

Does this company have between 10–100 employees? If unknown or > 100 $\rightarrow$ REJECT.
Is there direct proof of hiring software developers? If no careers link or job proof $\rightarrow$ REJECT.
Did user ask for no website? If website exists $\rightarrow$ REJECT.
Did user ask for owner name? If missing $\rightarrow$ REJECT.
Only leads passing 100% of the critic's checklist are added to the store. If rejected, the controller loops until genuine matching leads hit the target count.

4. Real TypeSafe JEV-1.14 Verification (No Fakes)
JEV receives:

The user's exact requirements.
The Critic's pass/fail summary and 3 full candidate leads with their verified fields.
JEV evaluates via /api/alpha/decisions:
are_mandatory_fields_present: Checks if requested emails, websites, or career URLs are filled.
are_constraints_honored: Checks if constraints (size, location, hiring, no-website) are genuinely satisfied. If it fails, JEV returns decision: false with the exact failing criteria.
5. Budget Protection
Worker / Search parser: openai:gpt-4.1-nano ($0.10/1M tokens, ultra-fast).
Critic & Final Reviewer: openai:gpt-5.1-mini (runs only on candidates, capped at max 3 review rounds).
Hard budget cutoff: Max 4 rounds to prevent runaway costs.


===
 Dynamic Spec Parser (Step 1 of the Run)
When the user submits a prompt, the planner dynamically extracts:

required_fields: Exactly the columns the user asked for.
filters & constraints: Rules the Critic must enforce (e.g. employee_range: 10-100, hiring: software developer, has_website: false).
python
class LeadSpec(BaseModel):
    target_count: int
    required_fields: list[str]  # e.g. ["company_name", "website", "employee_range", "careers_page", "evidence_source"]
    constraints: list[str]      # e.g. ["Must be US-based", "Must have 10-100 employees", "Actively hiring software developers"]
2. The Dynamic Lead Object
Every lead stored and returned is a dynamic dictionary whose keys match the user's requested fields:

python
class DynamicLead(BaseModel):
    data: dict[str, Any]       # Exactly the fields requested (e.g. {"company_name": "...", "careers_page": "...", "employee_range": "25-50"})
    source_url: str            # Ground-truth URL where the data was verified
    critic_verified: bool      # True only if passed 100% of the critic's checklist
3. How This Solves Your 3 Real Queries
User Prompt	Dynamic Fields Generated	Critic Verification Rules
"Find 10 AI startups in India with company name and website"	company_name, website	Rejects if not India-based, rejects if not AI startup.
"Find 20 SaaS companies in the USA with name, website, industry, LinkedIn URL"	company_name, website, industry, linkedin_url	Rejects if not US, rejects if LinkedIn or industry is missing.
"Find 50 US SaaS with 10–100 employees actively hiring software developers. Return company name, website, employee range, careers page, evidence source"	company_name, website, employee_range, careers_page, evidence_source	Rejects if employees > 100 or < 10. Rejects if no active software developer job listing found on careers page.
4. Dynamic UI Table & CSV Export
The UI table headers and the leads_result.csv columns are not hardcoded.
They are generated directly from lead.data.keys().
If the user asks for 3 fields, the CSV has 3 columns. If they ask for 5 fields, the CSV has 5 columns.