from __future__ import annotations

import asyncio
import json
import os
import signal as signal_mod
import socket
import threading
import urllib.parse
from typing import TYPE_CHECKING, Any, Callable, Dict, List, Optional, Tuple, Union

from .banner import render_banner
from .limits import BodyTooLargeError
from .types import AttrDict

if TYPE_CHECKING:
    from .agent import CatelogAgent

ServerOptions = Dict[str, Any]


class IncomingHttpRequest:
    """Normalized HTTP request object passed to `agent.handle_request`."""

    def __init__(
        self,
        method: str,
        url: str,
        headers: Dict[str, str],
        remote_addr: str = "127.0.0.1",
        body_reader: Optional[Callable[[Optional[int]], Any]] = None,
        raw_body: Optional[bytes] = None,
    ) -> None:
        self.method = method.upper()
        self.url = url
        self.headers = {k.lower(): v for k, v in headers.items()}
        self.remote_addr = remote_addr
        self._body_reader = body_reader
        self._raw_body = raw_body

    @property
    def socket(self) -> AttrDict:
        return AttrDict(remoteAddress=self.remote_addr, remote_address=self.remote_addr)

    async def read_body(self, max_bytes: Optional[int] = None) -> bytes:
        declared_str = self.headers.get("content-length")
        if declared_str:
            try:
                declared = int(declared_str)
                if max_bytes is not None and declared > max_bytes:
                    raise BodyTooLargeError(max_bytes)
            except ValueError:
                pass

        if self._raw_body is not None:
            if max_bytes is not None and len(self._raw_body) > max_bytes:
                raise BodyTooLargeError(max_bytes)
            return self._raw_body

        if self._body_reader is not None:
            data = await self._body_reader(max_bytes)
            return data

        return b""


class OutgoingHttpResponse:
    """Normalized HTTP response writer supporting both JSON and streaming SSE."""

    def __init__(
        self,
        writer: Optional[asyncio.StreamWriter] = None,
    ) -> None:
        self._writer = writer
        self.status_code: int = 200
        self.headers: Dict[str, str] = {}
        self.headers_sent: bool = False
        self.writable_ended: bool = False
        self._close_callbacks: List[Callable[[], Any]] = []
        self._body_chunks: List[bytes] = []
        self._disconnect_task: Optional[asyncio.Task[None]] = None

    @property
    def headersSent(self) -> bool:
        return self.headers_sent

    @property
    def writableEnded(self) -> bool:
        return self.writable_ended

    def set_header(self, name: str, value: str) -> None:
        self.headers[name] = str(value)

    def setHeader(self, name: str, value: str) -> None:
        self.set_header(name, value)

    def write_head(self, status_code: int, headers: Optional[Dict[str, str]] = None) -> None:
        if self.headers_sent:
            return
        self.status_code = status_code
        if headers:
            for k, v in headers.items():
                self.headers[k] = str(v)
        self.headers_sent = True
        if self._writer is not None:
            reason = _HTTP_REASONS.get(status_code, "OK")
            lines = [f"HTTP/1.1 {status_code} {reason}\r\n"]
            for k, v in self.headers.items():
                lines.append(f"{k}: {v}\r\n")
            lines.append("\r\n")
            self._writer.write("".join(lines).encode("latin-1"))

    def writeHead(self, status_code: int, headers: Optional[Dict[str, str]] = None) -> None:
        self.write_head(status_code, headers)

    def flush_headers(self) -> None:
        if not self.headers_sent:
            self.write_head(self.status_code)

    def flushHeaders(self) -> None:
        self.flush_headers()

    def write(self, data: Union[str, bytes]) -> None:
        if self.writable_ended:
            return
        if not self.headers_sent:
            self.write_head(self.status_code)
        b = data.encode("utf-8") if isinstance(data, str) else bytes(data)
        self._body_chunks.append(b)
        if self._writer is not None:
            try:
                self._writer.write(b)
            except Exception:
                self._trigger_close()

    def end(self, data: Optional[Union[str, bytes]] = None) -> None:
        if self.writable_ended:
            return
        if data is not None:
            self.write(data)
        elif not self.headers_sent:
            self.write_head(self.status_code)
        self.writable_ended = True
        if self._disconnect_task and not self._disconnect_task.done():
            self._disconnect_task.cancel()
        if self._writer is not None:
            try:
                if self._writer.can_write_eof():
                    self._writer.write_eof()
                self._writer.close()
            except Exception:
                pass
        self._trigger_close()

    def on(self, event: str, callback: Callable[[], Any]) -> None:
        if event == "close":
            self._close_callbacks.append(callback)

    def _trigger_close(self) -> None:
        cbs = list(self._close_callbacks)
        self._close_callbacks.clear()
        for cb in cbs:
            try:
                cb()
            except Exception:
                pass


_HTTP_REASONS = {
    200: "OK",
    202: "Accepted",
    204: "No Content",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    413: "Payload Too Large",
    429: "Too Many Requests",
    500: "Internal Server Error",
    503: "Service Unavailable",
}


class CatelogServer:
    """
    Running HTTP server handle returned by `agent.listen()`.
    Compatible with both Python (`server.port`, `server.url`, `server.close()`)
    and Node.js test patterns (`server.address().port`, `server.on("listening", cb)`).
    """

    def __init__(
        self,
        sock: socket.socket,
        host: str,
        port: int,
        url: str,
    ) -> None:
        self._sock = sock
        self.host = host
        self.port = port
        self.url = url
        self._asyncio_server: Optional[asyncio.AbstractServer] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._closed = False
        self._active_writers: set[asyncio.StreamWriter] = set()

    def address(self) -> AttrDict:
        return AttrDict(port=self.port, address=self.host, family="IPv4")

    def on(self, event: str, callback: Callable[..., Any]) -> "CatelogServer":
        if event == "listening":
            try:
                res = callback()
                if asyncio.iscoroutine(res) and self._loop:
                    self._loop.create_task(res)
            except Exception:
                pass
        return self

    def close(self, callback: Optional[Callable[[], Any]] = None) -> None:
        if self._closed:
            if callback:
                callback()
            return
        self._closed = True
        for w in list(self._active_writers):
            try:
                w.close()
            except Exception:
                pass
        self._active_writers.clear()
        if self._asyncio_server is not None and self._loop is not None:
            try:
                if self._loop.is_running():
                    self._loop.call_soon_threadsafe(self._asyncio_server.close)
            except Exception:
                pass
        try:
            self._sock.close()
        except Exception:
            pass
        if callback:
            callback()

    def close_idle_connections(self) -> None:
        pass

    def closeIdleConnections(self) -> None:
        pass

    def close_all_connections(self) -> None:
        self.close()

    def closeAllConnections(self) -> None:
        self.close()


async def _handle_tcp_client(
    agent: "CatelogAgent",
    server_handle: CatelogServer,
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
) -> None:
    server_handle._active_writers.add(writer)
    try:
        header_bytes = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=30.0)
    except Exception:
        server_handle._active_writers.discard(writer)
        try:
            writer.close()
        except Exception:
            pass
        return

    try:
        header_text = header_bytes.decode("latin-1")
        lines = header_text.split("\r\n")
        request_line = lines[0]
        parts = request_line.split(" ")
        if len(parts) < 2:
            writer.close()
            return
        method, path = parts[0], parts[1]
        headers: Dict[str, str] = {}
        for line in lines[1:]:
            if not line:
                continue
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()

        peer = writer.get_extra_info("peername")
        remote_addr = peer[0] if isinstance(peer, (tuple, list)) and len(peer) > 0 else "127.0.0.1"

        async def read_body(max_bytes: Optional[int] = None) -> bytes:
            te = headers.get("transfer-encoding", "").lower()
            if "chunked" in te:
                chunks: List[bytes] = []
                total = 0
                while True:
                    size_line = await reader.readuntil(b"\r\n")
                    chunk_size = int(size_line.strip().split(b";")[0], 16)
                    if chunk_size == 0:
                        await reader.readuntil(b"\r\n")
                        break
                    total += chunk_size
                    if max_bytes is not None and total > max_bytes:
                        raise BodyTooLargeError(max_bytes)
                    chunk_data = await reader.readexactly(chunk_size)
                    await reader.readexactly(2)  # \r\n
                    chunks.append(chunk_data)
                return b"".join(chunks)

            cl_str = headers.get("content-length")
            if not cl_str:
                return b""
            cl = int(cl_str)
            if max_bytes is not None and cl > max_bytes:
                raise BodyTooLargeError(max_bytes)
            if cl <= 0:
                return b""
            return await reader.readexactly(cl)

        req = IncomingHttpRequest(
            method=method,
            url=path,
            headers=headers,
            remote_addr=remote_addr,
            body_reader=read_body,
        )
        res = OutgoingHttpResponse(writer=writer)

        # Monitor disconnect after body is read when streaming SSE
        await agent.handle_request(req, res)
        if not res.writable_ended:
            res.end()
        try:
            await writer.drain()
        except Exception:
            pass
    except Exception:
        if not writer.is_closing():
            try:
                body = json.dumps(
                    {"error": {"code": "INTERNAL_CRASH", "message": "Unhandled server error"}}
                ).encode("utf-8")
                writer.write(
                    b"HTTP/1.1 500 Internal Server Error\r\n"
                    b"Content-Type: application/json\r\n"
                    b"Content-Length: " + str(len(body)).encode("ascii") + b"\r\n\r\n" + body
                )
                await writer.drain()
            except Exception:
                pass
    finally:
        server_handle._active_writers.discard(writer)
        try:
            writer.close()
        except Exception:
            pass


def start_agent_server(
    agent: "CatelogAgent",
    options: Optional[Dict[str, Any]] = None,
    *,
    port: Optional[int] = None,
    host: Optional[str] = None,
    silent: Optional[bool] = None,
    on_listening: Optional[Callable[[str], Any]] = None,
    onListening: Optional[Callable[[str], Any]] = None,
    handle_signals: Optional[bool] = None,
    handleSignals: Optional[bool] = None,
    shutdown_timeout_ms: Optional[int] = None,
    shutdownTimeoutMs: Optional[int] = None,
    block: Optional[bool] = None,
) -> CatelogServer:
    opts = options or {}
    env_port = int(os.environ["PORT"]) if "PORT" in os.environ and os.environ["PORT"].isdigit() else 3000
    resolved_port = int(port if port is not None else opts.get("port", env_port))
    resolved_host = str(host or opts.get("host") or "0.0.0.0")
    is_silent = bool(silent if silent is not None else opts.get("silent", False))
    on_listen = on_listening or onListening or opts.get("on_listening") or opts.get("onListening")
    do_signals = (
        handle_signals
        if handle_signals is not None
        else (
            handleSignals
            if handleSignals is not None
            else opts.get("handle_signals", opts.get("handleSignals", True))
        )
    )
    timeout_ms = int(
        shutdown_timeout_ms
        if shutdown_timeout_ms is not None
        else (
            shutdownTimeoutMs
            if shutdownTimeoutMs is not None
            else opts.get("shutdown_timeout_ms", opts.get("shutdownTimeoutMs", 25_000))
        )
    )

    # Bind socket synchronously so port (including port=0) is immediately bound and known!
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    bind_host = "127.0.0.1" if resolved_host == "localhost" else resolved_host
    sock.bind((bind_host, resolved_port))
    sock.listen(128)
    sock.setblocking(False)
    actual_port = sock.getsockname()[1]

    display_host = "localhost" if resolved_host == "0.0.0.0" else resolved_host
    url = f"http://{display_host}:{actual_port}"

    server_handle = CatelogServer(sock=sock, host=resolved_host, port=actual_port, url=url)

    def _notify_started() -> None:
        if callable(on_listen):
            on_listen(url)
        elif not is_silent:
            render_banner(
                "startup",
                {
                    "name": agent.name,
                    "url": url,
                    "mode": agent.mode,
                    "authConfigured": bool(agent.security.get_secret()),
                },
            )

    try:
        running_loop = asyncio.get_running_loop()
    except RuntimeError:
        running_loop = None

    if running_loop is not None:
        # Attach directly to the active asyncio event loop
        server_handle._loop = running_loop

        async def _attach() -> None:
            srv = await asyncio.start_server(
                lambda r, w: _handle_tcp_client(agent, server_handle, r, w),
                sock=sock,
            )
            server_handle._asyncio_server = srv
            _notify_started()

        running_loop.create_task(_attach())
        return server_handle

    # No event loop currently running
    should_block = block if block is not None else opts.get("block", True)
    if not should_block:
        ready_evt = threading.Event()

        def _bg_runner() -> None:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            server_handle._loop = loop

            async def _init_bg() -> None:
                srv = await asyncio.start_server(
                    lambda r, w: _handle_tcp_client(agent, server_handle, r, w),
                    sock=sock,
                )
                server_handle._asyncio_server = srv
                _notify_started()
                ready_evt.set()

            loop.create_task(_init_bg())
            loop.run_forever()

        t = threading.Thread(target=_bg_runner, daemon=True)
        server_handle._thread = t
        t.start()
        ready_evt.wait(timeout=5.0)
        return server_handle

    # Blocking standalone server mode (`if __name__ == "__main__": agent.listen(3000)`)
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    server_handle._loop = loop

    async def _serve_forever() -> None:
        srv = await asyncio.start_server(
            lambda r, w: _handle_tcp_client(agent, server_handle, r, w),
            sock=sock,
        )
        server_handle._asyncio_server = srv
        _notify_started()

    loop.run_until_complete(_serve_forever())

    if do_signals:
        _install_signal_handlers(agent, server_handle, loop, timeout_ms, is_silent)

    try:
        loop.run_forever()
    except KeyboardInterrupt:
        if not is_silent:
            print(f"[catelog] KeyboardInterrupt received, draining in-flight tasks (up to {timeout_ms}ms)...")
        loop.run_until_complete(agent.shutdown(timeout_ms))
        server_handle.close()
    finally:
        loop.close()

    return server_handle


startAgentServer = start_agent_server


def _install_signal_handlers(
    agent: "CatelogAgent",
    server: CatelogServer,
    loop: asyncio.AbstractEventLoop,
    timeout_ms: int,
    silent: bool,
) -> None:
    stopping = False

    def _stop(sig_name: str) -> None:
        nonlocal stopping
        if stopping:
            os._exit(1)
        stopping = True
        if not silent:
            print(f"[catelog] {sig_name} received, draining in-flight tasks (up to {timeout_ms}ms)...")
        server.close()

        async def _drain() -> None:
            try:
                await agent.shutdown(timeout_ms)
            except Exception as exc:
                print(f"[catelog] Shutdown error: {exc}")
            finally:
                loop.stop()

        loop.create_task(_drain())

    for sig in (signal_mod.SIGINT, signal_mod.SIGTERM):
        try:
            loop.add_signal_handler(sig, lambda s=sig: _stop(s.name))
        except (NotImplementedError, RuntimeError, ValueError):
            # Windows ProactorEventLoop fallback
            pass

