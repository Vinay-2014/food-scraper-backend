# Food Scraper Backend

A production-deployed web scraping API that automates food image retrieval for restaurant menus. Built to solve a real operational need at my team — reduces manual image sourcing time significantly.

## Live Deployment

- **Server:** AWS EC2 (t3.medium), Ubuntu
- **Domain:** menu-image-scraper.duckdns.org
- **Process Manager:** PM2 (auto-restart on crash)
- **Reverse Proxy:** Nginx with SSL termination via Certbot

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express |
| Scraping | Playwright (system Chrome), Cheerio, Axios |
| Process Management | PM2 |
| Web Server | Nginx |
| SSL | Certbot (Let's Encrypt) |
| DNS | DuckDNS |
| Cloud | AWS EC2 |

## Features

- Automated food image scraping from restaurant websites
- Image deduplication logic to avoid duplicate results
- Backend image proxy to bypass hotlink protection
- Structured API responses consumed by the React frontend
- Persistent deployment with PM2 process management and Nginx reverse proxy
- HTTPS enabled via Let's Encrypt SSL certificate

## Architecture

React Frontend (Netlify)
        |
        | HTTPS API calls
        v
Nginx (reverse proxy + SSL termination)
        |
        v
Express API (PM2 managed, port 3000)
        |
        v
Playwright / Cheerio / Axios (scraping layer)

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | /scrape | Scrape food images for a given restaurant URL |
| GET | /proxy | Proxy image requests to bypass hotlink protection |

## Deployment Setup

bash
# Clone and install
git clone https://github.com/Vinay-2014/food-scraper-backend
cd food-scraper-backend
npm install

# Start with PM2
pm2 start server.js --name food-scraper
pm2 save
pm2 startup

# Nginx config
sudo nano /etc/nginx/sites-available/food-scraper
sudo nginx -t && sudo systemctl reload nginx

# SSL
sudo certbot --nginx -d menu-image-scraper.duckdns.org

## Frontend

The React frontend for this project is available at: [food-scraper-frontend](https://github.com/Vinay-2014/food-scraper-frontend)
