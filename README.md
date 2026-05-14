# ThreeTwo Metadata Service

This [moleculer-based](https://github.com/moleculerjs/moleculer-web) microservice provides metadata endpoints for [ThreeTwo!](https://github.com/rishighan/threetwo), fetching comic book information from:

- **ComicVine** - Comprehensive comic database
- **Metron** - Community-driven comic metadata API
- **GCD (Grand Comics Database)** - Local SQLite database from GCD dumps
- **League of Comic Geeks** - Weekly pull list data

## Features

- **GraphQL API** - Unified query interface for all metadata sources
- **Volume-based Search** - Intelligent matching with scoring algorithms
- **Rate Limiting** - Respects API rate limits with automatic throttling
- **Caching** - Conditional requests with `If-Modified-Since` support
- **Socket.IO Events** - Real-time progress updates during searches

## Environment Variables

### Required

```bash
# ComicVine API
COMICVINE_API_KEY=your_comicvine_api_key

# Metron API (https://metron.cloud/accounts/signup/)
METRON_USERNAME=your_metron_username
METRON_PASSWORD=your_metron_password
```

### Optional

```bash
# Service Configuration
PORT=3080
NODE_ENV=development

# GCD (Grand Comics Database) - Local SQLite database
# Download from: https://www.comics.org/download/
GCD_DATABASE_PATH=/path/to/gcd.sqlite

# GCD Performance Tuning
GCD_ENABLE_WAL=true         # Enable Write-Ahead Logging
GCD_CACHE_SIZE=10000        # SQLite cache size in pages
```

## Local Development

1. Clone this repo
2. Copy environment variables:
   ```bash
   cp docker-compose.env.example docker-compose.env
   # Edit docker-compose.env with your API credentials
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Run the service:
   ```bash
   npm run dev
   ```
5. Access the API:
   - REST: `http://localhost:3080/api/`
   - GraphQL: `http://localhost:3080/graphql`

## Docker Instructions

1. Build the image:
   ```bash
   docker build . -t frishi/threetwo-metadata-service
   ```
2. Run with environment variables:
   ```bash
   docker run -it \
     -e COMICVINE_API_KEY=your_key \
     -e METRON_USERNAME=your_username \
     -e METRON_PASSWORD=your_password \
     -p 3080:3080 \
     frishi/threetwo-metadata-service
   ```

## API Endpoints

### REST Endpoints

#### ComicVine
- `GET /api/comicvine/search` - Search ComicVine
- `POST /api/comicvine/volumeBasedSearch` - Volume-based search with scoring
- `POST /api/comicvine/getVolumes` - Get volume details
- `POST /api/comicvine/getResource` - Get generic resource

#### Metron (v1)
- `GET /api/v1/metron/health` - Health check and rate limit status
- `GET /api/v1/metron/series/search?name=Batman` - Search series
- `GET /api/v1/metron/series/:id` - Get series details
- `GET /api/v1/metron/issue/search` - Search issues with filters
- `GET /api/v1/metron/issue/:id` - Get issue details
- `POST /api/v1/metron/volumeBasedSearch` - Volume-based search with scoring

#### GCD (v1) - Grand Comics Database
- `GET /api/v1/gcd/health` - Health check and database status
- `GET /api/v1/gcd/series/search?name=Batman` - Search series by name
- `GET /api/v1/gcd/series/:id` - Get series details
- `GET /api/v1/gcd/issue/search` - Search issues with filters
- `GET /api/v1/gcd/issue/:id` - Get issue details
- `GET /api/v1/gcd/issue/:issueId/stories` - Get stories for an issue
- `POST /api/v1/gcd/volumeBasedSearch` - Volume-based search with scoring

### GraphQL Queries

```graphql
# Check Metron service status
query {
  metronHealth {
    status
    configured
    rateLimit {
      burstRemaining
      sustainedRemaining
    }
  }
}

# Search for series
query SearchSeries($name: String!) {
  searchMetronSeries(input: { name: $name }) {
    count
    results {
      id
      name
      year_began
      publisher {
        name
      }
    }
  }
}

# Volume-based search (like ComicVine)
query VolumeSearch($name: String!, $issueNumber: String, $year: String) {
  metronVolumeBasedSearch(input: {
    scorerConfiguration: {
      searchParams: {
        name: $name
        issueNumber: $issueNumber
        year: $year
      }
    }
  }) {
    finalMatches {
      score
      issue {
        id
        issueNumber
        title
        cover_date
      }
      series {
        name
        publisher {
          name
        }
      }
    }
  }
}

# GCD: Search for series
query SearchGCDSeries($name: String!) {
  searchGCDSeries(input: { name: $name }) {
    count
    results {
      id
      name
      year_began
      issue_count
      publisher {
        name
      }
    }
  }
}

# GCD: Volume-based search
query GCDVolumeSearch($name: String!, $issueNumber: String, $year: String) {
  gcdVolumeBasedSearch(input: {
    scorerConfiguration: {
      searchParams: {
        name: $name
        issueNumber: $issueNumber
        year: $year
      }
    }
  }) {
    finalMatches {
      score
      issue {
        id
        issueNumber
        key_date
      }
      series {
        name
        publisher {
          name
        }
      }
    }
  }
}
```

### GraphQL Mutations

```graphql
# Apply Metron metadata to a comic
mutation ApplyMetadata($comicId: ID!, $issueId: Int!, $seriesId: Int!) {
  applyMetronMetadata(input: {
    comicObjectId: $comicId
    metronIssueId: $issueId
    metronSeriesId: $seriesId
  }) {
    success
    message
    updatedAt
  }
}
```

## Socket.IO Events

The service broadcasts real-time progress updates during searches:

### ComicVine Events
- **Event:** `CV_SCRAPING_STATUS`
- **Stages:** `fetching_volumes`, `ranking_volumes`, `searching_issues`, `fetching_volume_details`, `scoring_matches`, `complete`, `error`

### Metron Events
- **Event:** `METRON_SCRAPING_STATUS`
- **Stages:** `fetching_series`, `ranking_series`, `searching_issues`, `fetching_details`, `scoring_matches`, `complete`, `error`

### GCD Events
- **Event:** `GCD_SCRAPING_STATUS`
- **Stages:** `searching_series`, `ranking_series`, `searching_issues`, `fetching_details`, `scoring_matches`, `complete`, `error`

## Architecture

```
threetwo-metadata-service/
├── services/
│   ├── api.service.ts        # REST API gateway
│   ├── gateway.service.ts    # GraphQL gateway
│   ├── comicvine.service.ts  # ComicVine API integration
│   ├── metron.service.ts     # Metron API integration
│   └── gcd.service.ts        # GCD SQLite integration
├── models/graphql/
│   ├── typedef.ts            # GraphQL type definitions
│   └── resolvers.ts          # GraphQL resolvers
├── types/
│   ├── metron.types.ts       # Metron TypeScript interfaces
│   └── gcd.types.ts          # GCD TypeScript interfaces
└── utils/
    ├── searchmatchscorer.utils.ts  # ComicVine scoring
    ├── metron-scorer.utils.ts      # Metron scoring
    └── gcd-scorer.utils.ts         # GCD scoring
```

## Metron API Notes

- **Authentication:** HTTP Basic Auth
- **Rate Limiting:**
  - Burst: Check `X-RateLimit-Burst-*` headers
  - Sustained: Check `X-RateLimit-Sustained-*` headers
- **Conditional Requests:** Uses `If-Modified-Since` / `Last-Modified` for caching
- **Documentation:** https://metron.cloud/wiki/api/api-documentation/

## GCD (Grand Comics Database) Notes

GCD is different from ComicVine and Metron because it uses a local SQLite database instead of an external API.

### Setup

1. **Download the GCD database dump:**
   - Visit https://www.comics.org/download/
   - Download the SQLite dump (compressed)
   - Extract to a local directory

2. **Configure the database path:**
   ```bash
   export GCD_DATABASE_PATH=/path/to/gcd.sqlite
   ```

3. **Optional performance tuning:**
   ```bash
   export GCD_ENABLE_WAL=true
   export GCD_CACHE_SIZE=10000
   ```

### Features

- **Offline Operation:** No API calls required; all data is local
- **Fast Queries:** Direct SQLite queries with indexed fields
- **Full Text Search:** LIKE queries on series and issue names
- **Variant Support:** Exposes variant issues with `variant_of_id` linking
- **Story Data:** Access to individual story data within issues
- **No Images:** GCD does not include cover images (image fields are null)

### Database Schema

The service queries these main GCD tables:
- `gcd_publisher` - Publisher information
- `gcd_series` - Comic series (equivalent to "volumes")
- `gcd_issue` - Individual issues
- `gcd_story` - Stories within issues

### Differences from ComicVine/Metron

| Feature | ComicVine/Metron | GCD |
|---------|------------------|-----|
| Data Source | External API | Local SQLite |
| Images | Yes | No |
| Rate Limiting | Yes | N/A |
| Offline Mode | No | Yes |
| Updates | Real-time | Manual dump download |

## Contributing

1. Fork the repository
2. Create a feature branch
3. Run linting: `npm run lint`
4. Submit a pull request

## License

MIT
