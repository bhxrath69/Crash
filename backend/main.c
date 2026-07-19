/*
 * main.c — Journal HTTP API server
 *
 * Exposes a minimal REST API consumed by the React frontend, and serves
 * the built frontend (dist/) directly so this can run as a standalone
 * portable app — no `npm run dev` needed on the target machine.
 *
 * Storage and static files are resolved RELATIVE TO THE EXECUTABLE'S OWN
 * LOCATION, not the current working directory — this is what makes it
 * safe to double-click from any USB drive letter/mount point on any OS.
 *
 * Build:  make
 * Run:    ./journal [port]   (default port 8080)
 *
 * Endpoints:
 *   GET    /api/health          → {"status":"ok"}
 *   GET    /api/entries         → JSON array of entries
 *   POST   /api/entries         → create entry, returns created entry
 *   DELETE /api/entries/{id}    → delete entry, returns {"ok":true}
 *   GET    /api/recovery-status → WAL replay count from last startup
 *   GET    /*                   → serves dist/ (the built frontend)
 *   OPTIONS *                   → CORS preflight (204)
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <sys/stat.h>
#include <errno.h>
#include <time.h>
#include "db.h"

#if defined(_WIN32)
  #include <winsock2.h>
  #include <ws2tcpip.h>
  #include <windows.h>
  #include <direct.h>
  #include <stdint.h>
  #include <fcntl.h>
  #include <io.h>
  typedef int socklen_t;
  #define CLOSESOCK closesocket
  #define SOCK_READ(fd, buf, len)  recv((fd), (buf), (int)(len), 0)
  #define SOCK_WRITE(fd, buf, len) send((fd), (buf), (int)(len), 0)
  #ifndef O_RDONLY
    #define O_RDONLY _O_RDONLY
  #endif
  #define open  _open
  #define close _close
  #define read  _read
#elif defined(__APPLE__)
  #include <mach-o/dyld.h>
  #include <unistd.h>
  #include <fcntl.h>
  #include <sys/time.h>
  #include <sys/socket.h>
  #include <sys/types.h>
  #include <netinet/in.h>
  #include <arpa/inet.h>
  #define CLOSESOCK close
  #define SOCK_READ(fd, buf, len)  recv((fd), (buf), (len), 0)
  #define SOCK_WRITE(fd, buf, len) send((fd), (buf), (len), 0)
#else
  #include <unistd.h>
  #include <fcntl.h>
  #include <sys/time.h>
  #include <sys/socket.h>
  #include <sys/types.h>
  #include <netinet/in.h>
  #include <arpa/inet.h>
  #define CLOSESOCK close
  #define SOCK_READ(fd, buf, len)  recv((fd), (buf), (len), 0)
  #define SOCK_WRITE(fd, buf, len) send((fd), (buf), (len), 0)
#endif

#define DEFAULT_PORT  8080
#define RECV_BUF_SIZE 131072   /* 128 KB — enough for large journal bodies */
#define RESP_BUF_SIZE 4194304  /* 4 MB — enough for a full entry list      */

/* Resolved once at startup in main(): the executable's own directory,
 * the database path inside <exe_dir>/data/, and the frontend directory
 * at <exe_dir>/dist/. Everything is relative to the executable, not the
 * current working directory, so this runs correctly no matter where the
 * USB drive is mounted or which folder you double-click from. */
static char g_exe_dir[4096];
static char g_data_db_path[4200];
static char g_dist_dir[4200];

/* Fill out_dir (size out_dir_len) with the directory containing the
 * running executable, cross-platform, no trailing slash. */
static void get_exe_dir(char *out_dir, size_t out_dir_len) {
    char path[4096];
    size_t n = 0;

#if defined(_WIN32)
    DWORD len = GetModuleFileNameA(NULL, path, sizeof(path));
    n = (len > 0) ? (size_t)len : 0;
#elif defined(__APPLE__)
    uint32_t size = sizeof(path);
    if (_NSGetExecutablePath(path, &size) != 0) n = 0;
    else n = strlen(path);
#else /* Linux */
    ssize_t r = readlink("/proc/self/exe", path, sizeof(path) - 1);
    n = (r > 0) ? (size_t)r : 0;
#endif

    if (n == 0) {
        /* Fallback: current directory, if we somehow couldn't resolve
         * the executable path on this platform. */
        snprintf(out_dir, out_dir_len, ".");
        return;
    }
    path[n] = '\0';

    /* Strip the filename, keep the directory. */
    for (size_t i = n; i > 0; i--) {
        if (path[i - 1] == '/' || path[i - 1] == '\\') {
            path[i - 1] = '\0';
            break;
        }
    }
    snprintf(out_dir, out_dir_len, "%s", path);
}

/* ── UUID-style id generation ─────────────────────────────────────────────── */

static void gen_id(char *out, size_t len) {
    static const char hex[] = "0123456789abcdef";
    unsigned char buf[16] = {0};

    int fd = open("/dev/urandom", O_RDONLY);
    if (fd >= 0) { read(fd, buf, sizeof(buf)); close(fd); }
    else { srand((unsigned)time(NULL)); for (int i=0;i<16;i++) buf[i]=(unsigned char)rand(); }

    size_t j = 0;
    for (int i = 0; i < 16 && j + 2 < len; i++) {
        out[j++] = hex[(buf[i] >> 4) & 0xF];
        out[j++] = hex[buf[i] & 0xF];
    }
    out[j] = '\0';
}

static void iso_now(char *out, size_t len) {
    time_t t = time(NULL);
    struct tm *tm = gmtime(&t);
    strftime(out, len, "%Y-%m-%dT%H:%M:%SZ", tm);
}

/* ── JSON helpers ─────────────────────────────────────────────────────────── */

/* Write a JSON-escaped version of `in` into `out` (null-terminated). */
static void json_escape(const char *in, char *out, size_t outlen) {
    size_t j = 0;
    for (size_t i = 0; in[i] && j + 2 < outlen; i++) {
        unsigned char c = (unsigned char)in[i];
        switch (c) {
            case '"':  if (j+2 < outlen) { out[j++]='\\'; out[j++]='"';  } break;
            case '\\': if (j+2 < outlen) { out[j++]='\\'; out[j++]='\\'; } break;
            case '\n': if (j+2 < outlen) { out[j++]='\\'; out[j++]='n';  } break;
            case '\r': if (j+2 < outlen) { out[j++]='\\'; out[j++]='r';  } break;
            case '\t': if (j+2 < outlen) { out[j++]='\\'; out[j++]='t';  } break;
            default:   out[j++] = (char)c; break;
        }
    }
    out[j] = '\0';
}

static int entry_to_json(const JournalEntry *e, char *buf, size_t len) {
    char t[DB_TITLE_LEN * 2], b[DB_BODY_LEN * 2], m[DB_MOOD_LEN * 2];
    json_escape(e->title,  t, sizeof(t));
    json_escape(e->body,   b, sizeof(b));
    json_escape(e->mood,   m, sizeof(m));
    return snprintf(buf, len,
        "{\"id\":\"%s\",\"title\":\"%s\",\"body\":\"%s\","
        "\"mood\":\"%s\",\"createdAt\":\"%s\",\"updatedAt\":\"%s\"}",
        e->id, t, b, m, e->created_at, e->updated_at);
}

/* Extract a JSON string field from a flat JSON object (no nesting needed). */
static int json_get_str(const char *json, const char *key, char *out, size_t outlen) {
    char needle[256];
    snprintf(needle, sizeof(needle), "\"%s\"", key);
    const char *p = strstr(json, needle);
    if (!p) return 0;
    p += strlen(needle);
    while (*p == ' ' || *p == ':' || *p == '\t') p++;
    if (*p != '"') return 0;
    p++;
    size_t i = 0;
    while (*p && *p != '"' && i + 1 < outlen) {
        if (*p == '\\' && *(p+1)) {
            p++;
            switch (*p) {
                case 'n': out[i++] = '\n'; break;
                case 'r': out[i++] = '\r'; break;
                case 't': out[i++] = '\t'; break;
                default:  out[i++] = *p;   break;
            }
        } else {
            out[i++] = *p;
        }
        p++;
    }
    out[i] = '\0';
    return 1;
}

/* ── HTTP response helpers ─────────────────────────────────────────────────── */

static const char *CORS_HEADERS =
    "Access-Control-Allow-Origin: *\r\n"
    "Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS\r\n"
    "Access-Control-Allow-Headers: Content-Type\r\n";

static void send_response(int sock, int status, const char *status_text, const char *body) {
    char header[1024];
    int hlen = snprintf(header, sizeof(header),
        "HTTP/1.1 %d %s\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        "Content-Length: %zu\r\n"
        "%s"
        "Connection: close\r\n"
        "\r\n",
        status, status_text, strlen(body), CORS_HEADERS);

    SOCK_WRITE(sock, header, hlen);
    SOCK_WRITE(sock, body, (int)strlen(body));
}

static void send_preflight(int sock) {
    char resp[512];
    int n = snprintf(resp, sizeof(resp),
        "HTTP/1.1 204 No Content\r\n%sConnection: close\r\n\r\n", CORS_HEADERS);
    SOCK_WRITE(sock, resp, n);
}

/* ── Request parsing ──────────────────────────────────────────────────────── */

typedef struct {
    char  method[16];
    char  path[512];
    char *body;          /* points into the original buffer after \r\n\r\n */
    int   content_length;
} Request;

static int parse_request(char *raw, Request *req) {
    if (sscanf(raw, "%15s %511s", req->method, req->path) != 2) return 0;

    const char *sep = strstr(raw, "\r\n\r\n");
    if (!sep) return 0;
    req->body = (char *)(sep + 4);

    const char *cl = strstr(raw, "Content-Length:");
    if (!cl) cl = strstr(raw, "content-length:");
    req->content_length = cl ? atoi(cl + 15) : 0;
    return 1;
}

/* ── Route handlers ───────────────────────────────────────────────────────── */

static void handle_health(int sock) {
    send_response(sock, 200, "OK", "{\"status\":\"ok\"}");
}

static void handle_recovery_status(int sock) {
    char buf[128];
    snprintf(buf, sizeof(buf), "{\"replayedOnLastStartup\":%d}",
             db_last_recovery_replay_count());
    send_response(sock, 200, "OK", buf);
}

static void handle_get_entries(int sock) {
    JournalEntry *entries = NULL;
    int count = 0;

    if (db_get_all_entries(&entries, &count) != 0) {
        send_response(sock, 500, "Internal Server Error", "{\"error\":\"db read failed\"}");
        return;
    }

    /* Each entry: max ~(DB_BODY_LEN * 2) bytes of JSON + overhead */
    size_t bufsize = (size_t)count * (DB_BODY_LEN * 2 + 256) + 16;
    char *buf = malloc(bufsize);
    if (!buf) {
        db_free_entries(entries, count);
        send_response(sock, 500, "Internal Server Error", "{\"error\":\"out of memory\"}");
        return;
    }

    char *p = buf;
    *p++ = '[';
    char ej[DB_BODY_LEN * 2 + 256];
    for (int i = 0; i < count; i++) {
        int n = entry_to_json(&entries[i], ej, sizeof(ej));
        if (n > 0) { memcpy(p, ej, n); p += n; }
        if (i < count - 1) *p++ = ',';
    }
    *p++ = ']';
    *p   = '\0';

    send_response(sock, 200, "OK", buf);
    free(buf);
    db_free_entries(entries, count);
}

static void handle_create_entry(int sock, Request *req) {
    if (!req->body || req->content_length == 0) {
        send_response(sock, 400, "Bad Request", "{\"error\":\"empty body\"}");
        return;
    }

    JournalEntry e;
    memset(&e, 0, sizeof(e));

    /* Use client-supplied id / timestamps if provided, otherwise generate */
    if (!json_get_str(req->body, "id", e.id, sizeof(e.id)) || !e.id[0])
        gen_id(e.id, sizeof(e.id));

    if (!json_get_str(req->body, "createdAt", e.created_at, sizeof(e.created_at)) || !e.created_at[0])
        iso_now(e.created_at, sizeof(e.created_at));

    iso_now(e.updated_at, sizeof(e.updated_at));

    if (!json_get_str(req->body, "title", e.title, sizeof(e.title)) || !e.title[0])
        strncpy(e.title, "Untitled", sizeof(e.title) - 1);

    json_get_str(req->body, "body", e.body, sizeof(e.body));

    if (!json_get_str(req->body, "mood", e.mood, sizeof(e.mood)) || !e.mood[0])
        strncpy(e.mood, "wild", sizeof(e.mood) - 1);

    if (db_create_entry(&e) != 0) {
        send_response(sock, 500, "Internal Server Error", "{\"error\":\"db write failed\"}");
        return;
    }

    char buf[DB_BODY_LEN * 2 + 256];
    entry_to_json(&e, buf, sizeof(buf));
    send_response(sock, 201, "Created", buf);
}

static void handle_delete_entry(int sock, const char *id) {
    if (!id || !*id) {
        send_response(sock, 400, "Bad Request", "{\"error\":\"missing id\"}");
        return;
    }
    if (db_delete_entry(id) != 0) {
        send_response(sock, 500, "Internal Server Error", "{\"error\":\"db delete failed\"}");
        return;
    }
    send_response(sock, 200, "OK", "{\"ok\":true}");
}

static const char *content_type_for(const char *path) {
    const char *dot = strrchr(path, '.');
    if (!dot) return "application/octet-stream";
    if (strcmp(dot, ".html") == 0) return "text/html; charset=utf-8";
    if (strcmp(dot, ".js")   == 0) return "application/javascript; charset=utf-8";
    if (strcmp(dot, ".css")  == 0) return "text/css; charset=utf-8";
    if (strcmp(dot, ".json") == 0) return "application/json; charset=utf-8";
    if (strcmp(dot, ".svg")  == 0) return "image/svg+xml";
    if (strcmp(dot, ".png")  == 0) return "image/png";
    if (strcmp(dot, ".ico")  == 0) return "image/x-icon";
    if (strcmp(dot, ".txt")  == 0) return "text/plain; charset=utf-8";
    return "application/octet-stream";
}

/* Serve a file from dist/, falling back to dist/index.html for unknown
 * routes (so a refresh on a client-side route still loads the app). */
static void handle_static(int sock, const char *req_path) {
    char rel[600];
    if (strcmp(req_path, "/") == 0) {
        snprintf(rel, sizeof(rel), "/index.html");
    } else {
        snprintf(rel, sizeof(rel), "%s", req_path);
    }

    char full_path[4800];
    snprintf(full_path, sizeof(full_path), "%s%s", g_dist_dir, rel);

    FILE *f = fopen(full_path, "rb");
    if (!f) {
        /* No dot in the last segment => likely a client-side route, not
         * a missing asset. Fall back to index.html (SPA-style routing). */
        const char *base = strrchr(rel, '/');
        base = base ? base + 1 : rel;
        if (!strchr(base, '.')) {
            snprintf(full_path, sizeof(full_path), "%s/index.html", g_dist_dir);
            f = fopen(full_path, "rb");
        }
    }
    if (!f) {
        send_response(sock, 404, "Not Found", "{\"error\":\"not found\"}");
        return;
    }

    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (size < 0) { fclose(f); send_response(sock, 500, "Internal Server Error", "{\"error\":\"stat failed\"}"); return; }

    char *data = malloc((size_t)size);
    if (!data) { fclose(f); send_response(sock, 500, "Internal Server Error", "{\"error\":\"oom\"}"); return; }
    size_t rd = fread(data, 1, (size_t)size, f);
    fclose(f);

    char header[512];
    int hlen = snprintf(header, sizeof(header),
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: %s\r\n"
        "Content-Length: %zu\r\n"
        "%s"
        "Connection: close\r\n"
        "\r\n",
        content_type_for(full_path), rd, CORS_HEADERS);

    SOCK_WRITE(sock, header, hlen);
    SOCK_WRITE(sock, data, (int)rd);
    free(data);
}

static void dispatch(int sock, Request *req) {
    if (strcmp(req->method, "OPTIONS") == 0) { send_preflight(sock); return; }

    if (strcmp(req->method, "GET") == 0) {
        if (strcmp(req->path, "/api/health") == 0)  { handle_health(sock); return; }
        if (strcmp(req->path, "/api/recovery-status") == 0) { handle_recovery_status(sock); return; }
        if (strcmp(req->path, "/api/entries") == 0) { handle_get_entries(sock); return; }
    }

    if (strcmp(req->method, "POST") == 0 && strcmp(req->path, "/api/entries") == 0) {
        handle_create_entry(sock, req);
        return;
    }

    if (strcmp(req->method, "DELETE") == 0 && strncmp(req->path, "/api/entries/", 13) == 0) {
        handle_delete_entry(sock, req->path + 13);
        return;
    }

    if (strcmp(req->method, "GET") == 0 && strncmp(req->path, "/api/", 5) != 0) {
        handle_static(sock, req->path);
        return;
    }

    send_response(sock, 404, "Not Found", "{\"error\":\"not found\"}");
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

static void ensure_dir(const char *path) {
#if defined(_WIN32)
    _mkdir(path);
#else
    mkdir(path, 0700);
#endif
}

int main(int argc, char *argv[]) {
    int port = DEFAULT_PORT;
    const char *env_port = getenv("PORT");
    if (env_port) port = atoi(env_port);
    else if (argc > 1) port = atoi(argv[1]);

#if defined(_WIN32)
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        fprintf(stderr, "WSAStartup failed\n");
        return 1;
    }
#endif

    get_exe_dir(g_exe_dir, sizeof(g_exe_dir));

    char data_dir[4200];
    snprintf(data_dir, sizeof(data_dir), "%s/data", g_exe_dir);
    ensure_dir(data_dir);
    snprintf(g_data_db_path, sizeof(g_data_db_path), "%s/journal.db", data_dir);
    snprintf(g_dist_dir, sizeof(g_dist_dir), "%s/dist", g_exe_dir);

    printf("Portable Journal starting.\n");
    printf("  Executable dir: %s\n", g_exe_dir);
    printf("  Database path:  %s\n", g_data_db_path);
    printf("  Frontend dir:   %s\n", g_dist_dir);

    if (db_init(g_data_db_path) != 0) {
        fprintf(stderr, "Failed to open database\n");
        return 1;
    }

    int srv = socket(AF_INET, SOCK_STREAM, 0);
    if (srv < 0) { perror("socket"); return 1; }

    int opt = 1;
    setsockopt(srv, SOL_SOCKET, SO_REUSEADDR, (const char *)&opt, sizeof(opt));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family      = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port        = htons((uint16_t)port);

    if (bind(srv, (struct sockaddr *)&addr, sizeof(addr)) < 0) { perror("bind"); return 1; }
    if (listen(srv, 32) < 0) { perror("listen"); return 1; }

    printf("Journal API  →  http://localhost:%d\n", port);
    fflush(stdout);

    char *buf = malloc(RECV_BUF_SIZE);
    if (!buf) { fprintf(stderr, "OOM\n"); return 1; }

    while (1) {
        struct sockaddr_in cli_addr;
        socklen_t cli_len = sizeof(cli_addr);
        int cli = accept(srv, (struct sockaddr *)&cli_addr, &cli_len);
        if (cli < 0) { perror("accept"); continue; }

        /* 5-second receive timeout, cross-platform */
#if defined(_WIN32)
        DWORD tv_ms = 5000;
        setsockopt(cli, SOL_SOCKET, SO_RCVTIMEO, (const char *)&tv_ms, sizeof(tv_ms));
#else
        struct timeval tv = { .tv_sec = 5, .tv_usec = 0 };
        setsockopt(cli, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
#endif

        int n = (int)recv(cli, buf, RECV_BUF_SIZE - 1, 0);
        if (n > 0) {
            buf[n] = '\0';
            Request req;
            memset(&req, 0, sizeof(req));
            if (parse_request(buf, &req)) dispatch(cli, &req);
        }

        CLOSESOCK(cli);
    }

    free(buf);
    db_close();
    CLOSESOCK(srv);
#if defined(_WIN32)
    WSACleanup();
#endif
    return 0;
}