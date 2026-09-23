"""Give the real TUI a sized terminal; forward its output and terminal replies."""
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

pid, fd = pty.fork()
if pid == 0:
    os.execvpe(sys.argv[1], sys.argv[1:], os.environ)

fcntl.ioctl(
    fd,
    termios.TIOCSWINSZ,
    struct.pack("HHHH", int(os.environ.get("USAGE_SMOKE_ROWS", "54")), int(os.environ.get("USAGE_SMOKE_COLS", "160")), 0, 0),
)

def stop(*_):
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass

signal.signal(signal.SIGTERM, stop)
try:
    while True:
        ready, _, _ = select.select([fd, sys.stdin.fileno()], [], [], 1)
        for source in ready:
            data = os.read(source, 65536)
            if not data:
                raise EOFError
            os.write(sys.stdout.fileno() if source == fd else fd, data)
except (OSError, EOFError):
    pass
finally:
    stop()
    os.close(fd)
    os.waitpid(pid, 0)
