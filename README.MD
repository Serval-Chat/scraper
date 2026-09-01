# Serchat Scraper

This server is used to scrape the internet on demand and provides unauthorized WebSocket server for Serchat backend.

## Requirements

`ffprobe` (from ffmpeg) must be on `PATH` because I said so.

## Installation

```
git clone https://github.com/Serval-chat/scraper
cd scraper
npm i
cp .env.example .env # Don't forget to edit this
npm run build
npm run start
```