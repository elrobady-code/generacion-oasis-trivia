const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let salas = {};

io.on('connection', (socket) => {
    // Crear sala con temática
    socket.on('crearSala', (data) => {
        const { codigo, listaPreguntas } = data;
        
        salas[codigo] = {
            host: socket.id,
            preguntas: listaPreguntas && listaPreguntas.length > 0 ? listaPreguntas : [
                { pregunta: "¿Cómo se llama el guía de esta aventura bíblica?", opciones: ["Melki", "Josué", "David", "Moisés"], correcta: 0 }
            ],
            indicePregunta: 0,
            jugadores: {},
            tiempoRestante: 15,
            intervaloPregunta: null,
            respuestasEstaRonda: {}
        };

        socket.join(codigo);
        socket.emit('salaCreadaExito', codigo);
    });

    // Unirse a sala como jugador
    socket.on('unirseSala', (data) => {
        const { codigo, nombre, avatar } = data;
        const salaUpper = codigo.toUpperCase();

        if (salas[salaUpper]) {
            salas[salaUpper].jugadores[socket.id] = { nombre, avatar, puntaje: 0 };
            socket.join(salaUpper);
            socket.emit('unidoExito', salaUpper);
            
            io.to(salas[salaUpper].host).emit('actualizarListaJugadores', salas[salaUpper].jugadores);
        } else {
            socket.emit('errorUnirse', 'Esta sala no existe o el código es incorrecto.');
        }
    });

    // Anfitrión inicia o pasa a la siguiente pregunta
    socket.on('siguientePregunta', (codigo) => {
        const sala = salas[codigo];
        if (sala && socket.id === sala.host) {
            if (sala.intervaloPregunta) clearInterval(sala.intervaloPregunta);

            if (sala.indicePregunta < sala.preguntas.length) {
                const preguntaActual = sala.preguntas[sala.indicePregunta];
                sala.tiempoRestante = 15;
                sala.respuestasEstaRonda = {};

                io.to(codigo).emit('lanzarPregunta', {
                    pregunta: preguntaActual.pregunta,
                    opciones: preguntaActual.opciones,
                    indice: sala.indicePregunta,
                    total: sala.preguntas.length,
                    tiempo: sala.tiempoRestante
                });

                sala.intervaloPregunta = setInterval(() => {
                    sala.tiempoRestante--;
                    io.to(codigo).emit('actualizarTiempo', sala.tiempoRestante);

                    if (sala.tiempoRestante <= 0) {
                        clearInterval(sala.intervaloPregunta);
                        io.to(codigo).emit('finTiempo', {
                            correcta: preguntaActual.correcta,
                            puntajes: sala.jugadores
                        });
                        sala.indicePregunta++; // Se incrementa SOLO al finalizar la pregunta
                    }
                }, 1000);

            } else {
                const ranking = Object.values(sala.jugadores).sort((a, b) => b.puntaje - a.puntaje);
                io.to(codigo).emit('juegoTerminado', ranking);
            }
        }
    });

    // Recibir respuesta del jugador
    socket.on('enviarRespuesta', (data) => {
        const { codigo, opcionIndex, tiempoRestante } = data;
        const sala = salas[codigo];
        
        if (sala && sala.jugadores[socket.id] && !sala.respuestasEstaRonda[socket.id]) {
            sala.respuestasEstaRonda[socket.id] = true;
            const preguntaActual = sala.preguntas[sala.indicePregunta];

            const esCorrecta = (opcionIndex === preguntaActual.correcta);
            if (esCorrecta) {
                const puntosGanados = 500 + (tiempoRestante * 33);
                sala.jugadores[socket.id].puntaje += Math.round(puntosGanados);
            }

            socket.emit('resultadoIndividual', esCorrecta);
            io.to(sala.host).emit('actualizarProgresoRespuestas', Object.keys(sala.respuestasEstaRonda).length);
        }
    });

    socket.on('disconnect', () => {
        console.log('Usuario desconectado:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor activo en puerto ${PORT}`);
});
