## ADDED Requirements

### Requirement: Helper containers publish on loopback only

The PlantUML and Gotenberg helper containers SHALL be published with an explicit loopback host address (`-p 127.0.0.1:<port>:<container port>`) and never on all host interfaces. Before reusing a running or stopped container of either fixed name, the engine SHALL read its configured port bindings (`docker inspect`, which works while stopped) and, unless every host address is exactly `127.0.0.1` or `::1`, remove the container and create a new one. A failed removal SHALL fail closed.

#### Scenario: New container is loopback-published

- **WHEN** the engine creates either helper container
- **THEN** the `docker run` arguments SHALL contain `-p 127.0.0.1:<port>:<container port>`

#### Scenario: Legacy wildcard container is recreated

- **GIVEN** a container of the fixed name exists, running or stopped, published on `0.0.0.0`
- **WHEN** the engine ensures the server is running
- **THEN** it SHALL remove that container and create a loopback-published one, and log a warning

#### Scenario: Stopped legacy wildcard container is recreated, not started

- **GIVEN** a stopped container of the fixed name whose configured port binding has an empty or `0.0.0.0` host address
- **WHEN** the engine ensures the server is running
- **THEN** it SHALL NOT run `docker start` on it; it SHALL remove it and create a loopback-published one

#### Scenario: Loopback container is reused

- **GIVEN** a container of the fixed name is bound to `127.0.0.1`
- **WHEN** the engine ensures the server is running
- **THEN** it SHALL reuse it without recreating it

#### Scenario: IPv6 loopback container is reused

- **GIVEN** a container of the fixed name whose configured host address is `::1`
- **WHEN** the engine ensures the server is running
- **THEN** it SHALL reuse it without recreating it

#### Scenario: Other spellings and mixed bindings are recreated

- **WHEN** the configured host address is `127.0.0.2` or `localhost`, or the container port has two bindings of which one is `127.0.0.1` and one is `0.0.0.0`
- **THEN** the engine SHALL treat the container as non-loopback, remove it and create a loopback-published one

#### Scenario: A failed removal fails closed

- **GIVEN** a non-loopback container of the fixed name
- **WHEN** `docker rm -f` fails for any reason other than "No such container"
- **THEN** the engine SHALL raise the server error, SHALL NOT run `docker start` or reuse that container, and SHALL NOT create a new one

#### Scenario: A container that vanished during removal is not an error

- **WHEN** `docker rm -f` reports "No such container"
- **THEN** the engine SHALL continue and create a loopback-published container

#### Scenario: Unparsable port output

- **WHEN** the inspected port bindings of an existing container are absent or cannot be parsed
- **THEN** the engine SHALL treat the container as non-loopback and recreate it
