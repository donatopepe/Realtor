/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */



	// The root URL for the RESTful services
var rootURL = "http://realtor.dntppe.net/realtor/api/scheda";


var scheda = { 

	//dati scheda
	data: {nome: "", indirizzo: "", descrizione: "", prezzo: "0,00"},


	remove: function(nome) { 
	//metodo per cancellare scheda da chiave
			if (nome != "") {
				console.log('Cancello scheda ' + nome);
				app.storage.removeItem($.trim(nome));
			};
		},


	load: function(nome) {
	//metodo per recupero scheda da chiave
			if (nome != "") {   //chiave non vuota
					console.log('Carico scheda ' + nome);
					var value = app.storage.getItem($.trim(nome));
					scheda.data = JSON.parse(value);
			};
	},

	save: function() {
		if (scheda.data.nome != "") {			//chiave univoca
					console.log('Salvo su storage scheda ' + JSON.stringify(scheda.data));
					app.storage.setItem(scheda.data.nome, JSON.stringify(scheda.data));		//salva i dati
							}
		},

	addscheda: function(scheda, successCallback, failCallback) {
	console.log('addscheda:'+scheda);
	$.ajax({
		type: 'POST',
		contentType: 'application/json',
		url: rootURL,
		dataType: "json",
		data: scheda
	})
		.done(function (response){
				console.log('ok invio:'+response);
				successCallback();
				})
		.fail(function (response){
			console.log('error invio:' + response);
			failCallback();
		});
	

	}/*,	

	send: function(listaSchede, successCallback, failCallback) {
        console.log(JSON.stringify(listaSchede));
		$.ajax({
			url: rootURL,
			type: "POST",
			data: listaSchede})
		.done(function (response){
				console.log(response);
				//app.storage.clear();
				successCallback();
				})
		.fail(function (response){
			console.log(response);
			failCallback();
			});
	
    }*/
/*    
    //Alla funzione di callback verr� passato un indice numerico che indica quale pulsante, nessuna selezione viene passato il valore zero.
    confirmedSend: function(buttonIndex) {
        
        if (buttonIndex == 1) {
             
            //Istruzioni per l'invio
            navigator.notification.alert("Schede inviate!", function(){}, "Informazione");
        }
    }*/
    
};

var app = {

    // Application Constructor
    initialize: function() {
        this.bindEvents();
    },
    // Bind Event Listeners
    //
    // Bind any events that are required on startup. Common events are:
    // 'load', 'deviceready', 'offline', and 'online'.
    bindEvents: function() {
        document.addEventListener('deviceready', this.onDeviceReady, false);
                
        document.addEventListener("online", app.online, false);
		document.addEventListener("offline", app.offline, false);
		
		
        $.mobile.allowCrossDomainPages = true;
		$.support.cors = true;
		
		
		 
        //assegnamento della gestione dell�evento tap, l�evento corrispondente al tocco sul pulsante
        $("#btnSalva").on("tap", function() {
        
			scheda.data.nome = $("#txtNome").val();
			scheda.data.indirizzo = $("#txtIndirizzo").val();
			scheda.data.descrizione = $("#txtDescrizione").val();
			scheda.data.prezzo = $("#txtPrezzo").val();
			console.log('Salvo la scheda ' + scheda.data.nome);
			scheda.save();
			
		
			// messaggio da visualizzare, titolo della finestra di dialogo ed il testo da visualizzare
        	navigator.notification.alert("Salvataggio effettuato!",
                                     function() {},
                                     "Informazione",
                                     "OK");
    	
		});
        //Al pulsante exit assegniamo il metodo per chiudere l�applicazione
        $("#btnExit").on("tap", app.exit);

	    //elenco delle schede memorizzate uso l'�evento pagebeforeshow della schermata elencoSchede
    
   		 $("#elencoSchede").on("pagebeforeshow", function(event) {

				var elencoSchede = $("#liElencoSchede");  //id in index.html
				elencoSchede.html("");					 //svuoto
				
				var li = $("<li data-role='list-divider' role='heading'>Schede</li>");
				elencoSchede.append(li); 
				
				// per tutti gli elementi memorizzati
				for (var i=0; i<app.storage.length; i++) {
				//per ciascun elemento creo un item
			      	console.log('Carico da storage e creo elemento lista ' + i + ' su ' + app.storage.length);

					var li = $("<li data-theme='c'><a href='#' data-transition='slide'>" + 
									app.storage.key(i) + //metodo key()consente di recuperare la chiave dell�i-esimo elemento
								"</a></li>");
								
					li.on("tap", function() {
							var key = $(this).text();
					      	console.log('Per visualizzare carico dati elemento lista ' + key);
							scheda.load(key);
							
							$("#txtNome").val(scheda.data.nome);
							$("#txtIndirizzo").val(scheda.data.indirizzo);
							$("#txtDescrizione").val(scheda.data.descrizione);
							$("#txtPrezzo").val(scheda.data.prezzo);
							$.mobile.changePage($("#scheda"));
						});			

					//pressione prolungata sul�elemento della listview			
					li.on("taphold", function() {
								var key = $(this).text();
						      	console.log('pressione prolungata rimuovo scheda ' + key);
								navigator.notification.confirm(     //chiedo conferma
										"Confermi l'eliminazione della scheda?",
										function(buttonIndex) {
											if (buttonIndex == 1) {
													scheda.remove(key);
													$.mobile.changePage($("#elencoSchede"));   //?????
											}
										},
										"Conferma eliminazione",
										"Si,No");
							});			
								
					elencoSchede.append(li);  //appendo l'item
				};
				elencoSchede.listview("refresh");
			});
			
	        //invio delle schede
    	    $("#btnInviaSchede").on("tap", function() {

				if (app.isOnline()) {
					console.log('Connessione Internet disponibile preparo invio schede');
					navigator.notification.confirm(
					"Confermi l'invio delle schede?",
					function(buttonIndex) {
							if (buttonIndex == 1) {
								console.log('Confermato Invio schede');
								var listaSchede = [];
								
								for (var i=0; i<app.storage.length; i++) {

									var value = app.storage.getItem($.trim(app.storage.key(i)));
									console.log(value);
									scheda.addscheda(value,
										function() {
													console.log('Memorizzo scheda da rimuovere da storage');
													listaSchede.push($.trim(app.storage.key(i)));
										},
										function() {

										});
									
								};
								console.log(listaSchede);
								for (var i=0; i<listaSchede.length; i++) {
									console.log('Rimuovo scheda:' + listaSchede[i]);
									app.storage.removeItem(listaSchede[i]);
								}	
								
					/*			console.log('Caricate schede da storage');
								console.log('Chiamata AJAX al server ' + rootURL + ' per download schede ');
								scheda.send(listaSchede,
								function() {
										navigator.notification.alert("Schede inviate!", function(){},"Informazione");
								},
								function() {
										navigator.notification.alert("Si è verificato un problema durante l'invio delle schede!",
										function(){},"Errore");
								});*/
							};
					},
					"Conferma invio", 
					"Si,No");
				} else {
					console.log('Connessione Internet non disponibile');
	 				navigator.notification.alert("Connessione Internet non disponibile!", function()
					{},"Informazione");
				};
			});
    },

    
    // deviceready Event Handler
    //
    // The scope of 'this' is the event. In order to call the 'receivedEvent'
    // function, we must explicity call 'app.receivedEvent(...);'
    onDeviceReady: function() {
        app.receivedEvent('deviceready');
      	console.log('deviceready');
      		
    },

	online: function() {
		console.log('abilita invia schede');
		$("#btnInviaSchede").removeClass("ui-disabled");
		
	},
	offline: function() {
		console.log('disabilita invia schede');
		$("#btnInviaSchede").addClass("ui-disabled");
	},


    // Update DOM on a Received Event
    receivedEvent: function(id) {
        var parentElement = document.getElementById(id);
        var listeningElement = parentElement.querySelector('.listening');
        var receivedElement = parentElement.querySelector('.received');

        listeningElement.setAttribute('style', 'display:none;');
        receivedElement.setAttribute('style', 'display:block;');

        console.log('Received Event: ' + id);
    },

   
	storage: window.localStorage, //memorizzazione permanente , window.sessionStorage nel caso per sessione

    //stato online dell'applicazione
	isOnline: function() {
				var networkState = navigator.connection.type;
				return ((networkState != Connection.NONE) && (networkState != Connection.UNKNOWN));
	},
    exit: function() {
    
        navigator.notification.confirm(
              "Vuoi uscire dall'applicazione?",
                function(buttonIndex) {
                     
                    if (buttonIndex == 1){
                    		console.log('Uscita');
                     		navigator.app.exitApp();
                     }
                },
                "Informazione",
                "Si,No");
                
    }
};
