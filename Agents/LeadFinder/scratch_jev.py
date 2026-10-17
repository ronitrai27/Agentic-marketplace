import asyncio
import os
import httpx
from dotenv import load_dotenv

load_dotenv()

async def test_jev_decisions():
    key = os.getenv("OPENROUTER_JEV")
    url = "https://openrouter.ai/api/alpha/decisions"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    body = {
        "model": "typesafe/jev-1.14",
        "state": {
            "prompt": "find me 6 jewellery business in ludhiana that doesn't own a website"
        },
        "questions": {
            "is_local_places": {
                "type": "noul",
                "instructions": "Is this query searching for physical local businesses, shops, or places best found on Google Maps?",
                "criteria": {
                    "true": "Physical venue, local shop, restaurant, service provider, or city-specific venue.",
                    "false": "Digital online SaaS, global software, remote code repo."
                }
            },
            "requires_no_website": {
                "type": "noul",
                "instructions": "Does the user explicitly request businesses that do NOT own a website?",
                "criteria": {
                    "true": "Explicitly requests entities with no website, without a website, or that do not own a website.",
                    "false": "Does not restrict to businesses without websites."
                }
            }
        }
    }
    async with httpx.AsyncClient() as client:
        r = await client.post(url, headers=headers, json=body, timeout=15.0)
        print("Status:", r.status_code)
        print("Decisions:", r.json().get("decisions"))

if __name__ == "__main__":
    asyncio.run(test_jev_decisions())
