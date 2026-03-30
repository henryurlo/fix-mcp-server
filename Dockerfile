FROM python:3.11-slim

WORKDIR /app

# Copy ALL source files first — needed for wheel metadata validation
COPY README.md pyproject.toml ./
COPY src/ ./src/
COPY config/ ./config/

# Now install — hatchling can validate force-includes
RUN pip install --no-cache-dir .

ENV SCENARIO=morning_triage
ENV LOG_LEVEL=INFO

CMD ["python", "-m", "fix_mcp.server"]
