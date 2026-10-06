#!/usr/bin/python3 -I
"""Retired source-host deployment entry point; never mutate a migrated app."""
import sys


def main():
    print("This legacy NotifyContext deployment command is retired. "
          "Use the maintained once-pocketcontext-v2 scaffold and its restricted "
          "stop-first dispatcher; do not install this wrapper or restart retained source state.",
          file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
