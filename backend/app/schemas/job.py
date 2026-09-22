from pydantic import BaseModel

class JobResponse(BaseModel):
    id: int
    external_id: str | None = None
    company: str
    title: str
    location: str | None = None
    url: str | None = None
    description: str | None = None
    source: str | None = None
    model_config = {"from_attributes": True}

class JobLinkRequest(BaseModel):
    url: str
