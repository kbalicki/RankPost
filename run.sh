#!/bin/bash
cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
    echo "Tworzenie srodowiska wirtualnego..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
else
    source venv/bin/activate
fi

if [ ! -f ".env" ]; then
    echo "UWAGA: Brak pliku .env - skopiuj .env.example do .env i uzupelnij dane"
    cp .env.example .env
    exit 1
fi

echo "Uruchamiam RankPost na http://localhost:8000"
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
