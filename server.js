const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let salas = {};

// Función que toma una pregunta, mezcla sus opciones al azar y recalcula el nuevo índice correcto
function mezclarOpciones(pregunta) {
    // 1. Guardamos el texto real de la respuesta correcta antes de mezclar
    const textoCorrecto = pregunta.opciones[pregunta.correcta];
    const opcionesMezcladas = [...pregunta.opciones];

    // 2. Mezcla de las opciones (Algoritmo Fisher-Yates)
    for (let i = opcionesMezcladas.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [opcionesMezcladas[i], opcionesMezcladas[j]] = [opcionesMezcladas[j], opcionesMezcladas[i]];
    }

    // 3. Retornamos la pregunta con las opciones aleatorizadas y el índice correcto actualizado
    return {
        ...pregunta,
        opciones: opcionesMezcladas,
        correcta: opcionesMezcladas.indexOf(textoCorrecto)
    };
}

io.on('connection', (socket) => {
    // Crear sala con la lista de preguntas enviadas por el host
    socket.on('crearSala', (data) => {
        const { codigo, listaPreguntas } = data;
        
        const preguntasBase = (listaPreguntas && listaPreguntas.length > 0) ? listaPreguntas : [
            { pregunta: "¿Cómo se llama el guía de esta aventura bíblica?", opciones: ["Melki", "Josué", "David", "Moisés"], correcta: 0 }
        ];

        salas[codigo] = {
            host: socket.id,
            preguntas: preguntasBase,
            indicePregunta: 0,
            jugadores: {},
            tiempoRestante: 15,
            intervaloPregunta: null,
            respuestasEstaRonda: {}
        };

        socket.join(codigo);
        socket.emit('salaCreadaExito', codigo);
    });

    // Unirse a la sala como participante
    socket.on('unirseSala', (data) => {
        const { codigo, nombre, avatar } = data;
        const salaUpper = codigo.toUpperCase();

        if (salas[salaUpper]) {
            salas[salaUpper].jugadores[socket.id] = { nombre, avatar, puntaje: 0, racha: 0 };
            socket.join(salaUpper);
            socket.emit('unidoExito', salaUpper);
            
            io.to(salas[salaUpper].host).emit('actualizarListaJugadores', salas[salaUpper].jugadores);
        } else {
            socket.emit('errorUnirse', 'Esta sala no existe o el código es incorrecto.');
        }
    });

    // Anfitrión avanza o inicia la siguiente pregunta
    socket.on('siguientePregunta', (codigo) => {
        const sala = salas[codigo];
        if (sala && socket.id === sala.host) {
            if (sala.intervaloPregunta) clearInterval(sala.intervaloPregunta);

            if (sala.indicePregunta < sala.preguntas.length) {
                
                // MEZCLAR OPCIONES EN VIVO ANTES DE MOSTRAR LA PREGUNTA
                const preguntaOriginal = sala.preguntas[sala.indicePregunta];
                const preguntaMezclada = mezclarOpciones(preguntaOriginal);
                
                // Guardamos la versión mezclada para la evaluación de la ronda
                sala.preguntas[sala.indicePregunta] = preguntaMezclada;
                const preguntaActual = preguntaMezclada;

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
                        
                        // Evaluar respuestas y rachas al finalizar el tiempo
                        Object.keys(sala.jugadores).forEach((idSocket) => {
                            const jugador = sala.jugadores[idSocket];
                            const respuesta = sala.respuestasEstaRonda[idSocket];

                            if (respuesta && respuesta.opcionIndex === preguntaActual.correcta) {
                                jugador.racha += 1;
                                const bonusRacha = jugador.racha * 50;
                                const puntosGanados = 500 + (respuesta.tiempoRestante * 30) + bonusRacha;
                                jugador.puntaje += Math.round(puntosGanados);
                            } else {
                                jugador.racha = 0; // Se pierde la racha al fallar o no contestar
                            }
                        });

                        const numeroPreguntaEvaluada = sala.indicePregunta + 1;
                        const esCada5 = (numeroPreguntaEvaluada % 5 === 0);
                        const ranking = Object.values(sala.jugadores).sort((a, b) => b.puntaje - a.puntaje);

                        io.to(codigo).emit('finTiempo', {
                            correcta: preguntaActual.correcta,
                            jugadores: sala.jugadores,
                            respuestasEstaRonda: sala.respuestasEstaRonda,
                            ranking: ranking,
                            esCada5: esCada5,
                            numeroPregunta: numeroPreguntaEvaluada
                        });

                        sala.indicePregunta++; // Incrementa para la siguiente ronda
                    }
                }, 1000);

            } else {
                const ranking = Object.values(sala.jugadores).sort((a, b) => b.puntaje - a.puntaje);
                io.to(codigo).emit('juegoTerminado', ranking);
            }
        }
    });

    // Guardar la respuesta del celular sin evaluar inmediatamente
    socket.on('enviarRespuesta', (data) => {
        const { codigo, opcionIndex, tiempoRestante } = data;
        const sala = salas[codigo];
        
        if (sala && sala.jugadores[socket.id] && !sala.respuestasEstaRonda[socket.id]) {
            sala.respuestasEstaRonda[socket.id] = { opcionIndex, tiempoRestante };
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
