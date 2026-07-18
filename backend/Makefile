CC      = gcc
CFLAGS  = -O2 -Wall -Wextra -std=c11 -D_POSIX_C_SOURCE=200809L
TARGET  = journal
SRCS    = main.c db_custom.c
$(TARGET): $(SRCS) db.h
	$(CC) $(CFLAGS) -o $@ $(SRCS)
clean:
	rm -f $(TARGET) journal.db journal.db.wal journal.db.checkpoint
.PHONY: clean
