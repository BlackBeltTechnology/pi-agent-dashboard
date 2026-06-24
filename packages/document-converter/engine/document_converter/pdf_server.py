"""PDF conversion Docker server lifecycle management.

This module manages a Docker-based Gotenberg server for converting DOCX to PDF.
The server is started on-demand and can be stopped when no longer needed.

Uses Gotenberg (https://gotenberg.dev/) which supports ARM64/Apple Silicon natively.
"""
import atexit
import socket
import subprocess
import time
from typing import Optional
import urllib.request
import urllib.error


class PDFServerError(Exception):
    """Exception raised for PDF server errors."""
    pass


def get_available_port() -> int:
    """Get an available port for the PDF server.

    Returns:
        An available port number.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        s.listen(1)
        port = s.getsockname()[1]
    return port


def check_docker_available() -> bool:
    """Check if Docker is available and running.

    Returns:
        True if Docker is available, False otherwise.
    """
    try:
        result = subprocess.run(
            ['docker', 'info'],
            capture_output=True,
            timeout=10
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


class PDFServer:
    """Manages a Docker-based PDF conversion server using Gotenberg.

    The server uses a fixed container name to prevent multiple instances.
    Lifecycle management tracks whether this process started the container
    to determine if it should be stopped on exit.

    Gotenberg supports ARM64/Apple Silicon natively.
    API: POST /forms/libreoffice/convert with multipart form data.
    """

    CONTAINER_NAME = "docconv-pdf-server"
    IMAGE_NAME = "gotenberg/gotenberg:8"
    CONTAINER_PORT = 3000  # Gotenberg default port
    HEALTH_CHECK_TIMEOUT = 60  # seconds (Gotenberg takes longer to start)

    def __init__(self):
        """Initialize the PDF server manager."""
        self._started_by_us = False
        self._port: Optional[int] = None
        self._atexit_registered = False

    def is_container_running(self) -> bool:
        """Check if the PDF container is currently running.

        Returns:
            True if container is running, False otherwise.
        """
        result = subprocess.run(
            ['docker', 'ps', '--format', '{{.Names}}'],
            capture_output=True,
            text=True
        )
        return self.CONTAINER_NAME in result.stdout.split('\n')

    def is_container_exists(self) -> bool:
        """Check if the PDF container exists (running or stopped).

        Returns:
            True if container exists, False otherwise.
        """
        result = subprocess.run(
            ['docker', 'ps', '-a', '--format', '{{.Names}}'],
            capture_output=True,
            text=True
        )
        return self.CONTAINER_NAME in result.stdout.split('\n')

    def get_container_port(self) -> Optional[int]:
        """Get the host port mapped to the container's port.

        Returns:
            The host port number, or None if container is not running.
        """
        result = subprocess.run(
            ['docker', 'port', self.CONTAINER_NAME, str(self.CONTAINER_PORT)],
            capture_output=True,
            text=True
        )
        if result.returncode != 0 or not result.stdout.strip():
            return None

        # Parse output like "0.0.0.0:54321" or "0.0.0.0:54321->8000/tcp"
        port_str = result.stdout.strip().split(':')[-1]
        # Handle case where output includes ->8000/tcp
        port_str = port_str.split('->')[0]
        try:
            return int(port_str)
        except ValueError:
            return None

    def _wait_for_healthy(self, timeout: int = None) -> bool:
        """Wait for the PDF server to become healthy.

        Args:
            timeout: Maximum time to wait in seconds.

        Returns:
            True if server became healthy, False if timeout.
        """
        if timeout is None:
            timeout = self.HEALTH_CHECK_TIMEOUT

        port = self._port or self.get_container_port()
        if not port:
            return False

        # Gotenberg health check endpoint
        url = f"http://localhost:{port}/health"
        start_time = time.time()

        while time.time() - start_time < timeout:
            try:
                with urllib.request.urlopen(url, timeout=2) as response:
                    if response.status == 200:
                        return True
            except urllib.error.HTTPError as e:
                # 503 means still starting up
                if e.code not in (503,):
                    return True
            except (urllib.error.URLError, TimeoutError, ConnectionRefusedError):
                pass
            time.sleep(1)

        return False

    def _start_container(self) -> None:
        """Start an existing stopped container."""
        result = subprocess.run(
            ['docker', 'start', self.CONTAINER_NAME],
            capture_output=True,
            text=True
        )
        if result.returncode != 0:
            raise PDFServerError(
                f"Failed to start container: {result.stderr}"
            )

    def _create_container(self) -> None:
        """Create and start a new container."""
        self._port = get_available_port()
        result = subprocess.run(
            [
                'docker', 'run', '-d',
                '--name', self.CONTAINER_NAME,
                '-p', f'{self._port}:{self.CONTAINER_PORT}',
                self.IMAGE_NAME
            ],
            capture_output=True,
            text=True
        )
        if result.returncode != 0:
            raise PDFServerError(
                f"Failed to create container: {result.stderr}"
            )

    def _register_atexit(self) -> None:
        """Register atexit handler to stop container on Python exit."""
        if not self._atexit_registered:
            atexit.register(self.stop_if_started_by_us)
            self._atexit_registered = True

    def ensure_running(self) -> str:
        """Ensure the PDF server is running.

        If the container is already running, returns its URL.
        If the container exists but is stopped, starts it.
        If the container doesn't exist, creates and starts it.

        Returns:
            The base URL of the PDF server (e.g., "http://localhost:12345").

        Raises:
            PDFServerError: If Docker is not available or server fails to start.
        """
        if not check_docker_available():
            raise PDFServerError(
                "Docker is not available. Please install and start Docker."
            )

        # Check if already running
        if self.is_container_running():
            port = self.get_container_port()
            if port:
                self._port = port
                return f"http://localhost:{port}"

        # Start or create container
        if self.is_container_exists():
            self._start_container()
            self._started_by_us = True
            # Get the port after starting
            self._port = self.get_container_port()
        else:
            self._create_container()
            self._started_by_us = True

        # Wait for healthy
        if not self._wait_for_healthy():
            raise PDFServerError(
                "PDF server failed to become healthy within timeout"
            )

        # Register cleanup
        self._register_atexit()

        return f"http://localhost:{self._port}"

    def stop_if_started_by_us(self) -> None:
        """Stop the container only if this process started it.

        This allows external processes (like preHooks) to keep the
        container running across multiple invocations.
        """
        if not self._started_by_us:
            return

        try:
            subprocess.run(
                ['docker', 'stop', self.CONTAINER_NAME],
                capture_output=True,
                timeout=10
            )
        except (subprocess.TimeoutExpired, Exception):
            pass  # Best effort cleanup

    def get_base_url(self) -> Optional[str]:
        """Get the base URL of the running server.

        Returns:
            The base URL, or None if server is not running.
        """
        port = self._port or self.get_container_port()
        if port:
            return f"http://localhost:{port}"
        return None


# Global singleton instance
_server_instance: Optional[PDFServer] = None


def get_server() -> PDFServer:
    """Get the global PDF server instance.

    Returns:
        The global PDFServer instance.
    """
    global _server_instance
    if _server_instance is None:
        _server_instance = PDFServer()
    return _server_instance
