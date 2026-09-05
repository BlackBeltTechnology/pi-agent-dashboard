# 29-gateway-posix-no-tcp.sh — index

A POSIX DEFAULT start binds no bridge TCP port at all (task 13.8, #X16). Asserts `/api/health` advertises a `gateway-*.sock` path, the socket exists, NOTHING listens on the gateway port (checked twice — `lsof` and a connect probe, because each alone has a blind spot), and a bridge still registers over the socket so the absence is privacy rather than breakage. Hermetic `$HOME`, ports 18850/19850. Teeth: `PI_GATEWAY_TCP=1` flips it red with no code change. Runs on ubuntu + macOS in `ci-gateway-platform.yml`.
