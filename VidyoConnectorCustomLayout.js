const OPEN_REMOTE_SLOT = "-1";

// Keep track of attributes of remote camera sources:
// * max = maximum number of remote cameras to render; initialize to 8 but update as needed per resource manager recommendations.
// * count = total number of remote cameras that are streaming in the conference.
// * rendered = number of remote cameras that are locally rendered.
var remoteSources = { max: 8, count: 0, rendered: 0 }



// rendererSlots[0] is used to render the local camera;
// rendererSlots[1] through rendererSlots[8] are used to render up to 8 cameras from remote participants.
var rendererSlots = ["1", OPEN_REMOTE_SLOT];

// Run StartVidyoConnector when the VidyoClient is successfully loaded
function StartVidyoConnector(VC, configParams) {
    var selectingCamera = false;
    var vidyoConnector;
    var cameras = {};
    var microphones = {};
    var speakers = {};
    var selectedLocalCamera = {id: 0, camera: null};
    var cameraPrivacy = false;
    var microphonePrivacy = false;
    var remoteCameras = {};

    console.log("Number of remote slots: " + configParams.numRemoteSlots);
    remoteSources.max = configParams.numRemoteSlots;

    window.onresize = function() {
        showRenderers(vidyoConnector);
    };

    VC.CreateVidyoConnector({
        viewId: null, // Set to null in order to create a custom layout
        viewStyle: "VIDYO_CONNECTORVIEWSTYLE_Default",   // Visual style of the composited renderer
        remoteParticipants: configParams.numRemoteSlots, // Maximum number of participants to render
        logFileFilter: "warning info@VidyoClient info@VidyoConnector",
        logFileName:"",
        userData:""
    }).then(function(vc) {
        vidyoConnector = vc;

        // Don't display left panel if hideConfig is enabled.
        if (configParams.hideConfig=="1") {
            updateRenderers(vidyoConnector, true);
        }

        registerEventListeners(vidyoConnector, cameras, microphones, speakers, selectedLocalCamera, remoteCameras, configParams);
        handleDeviceChange(vidyoConnector, cameras, microphones, speakers);

        // Populate the connectionStatus with the client version
        vidyoConnector.GetVersion().then(function(version) {
            $("#clientVersion").html("v " + version);
        }).catch(function() {
            console.error("GetVersion failed");
        });

        // If enableDebug is configured then enable debugging
        if (configParams.enableDebug === "1") {
            vidyoConnector.EnableDebug({port:7776, logFilter: "warning info@VidyoClient info@VidyoConnector"}).then(function() {
                console.log("EnableDebug success");
            }).catch(function() {
                console.error("EnableDebug failed");
            });
        }

        // If running on Internet Explorer, set the default certificate authority list.
        // This is necessary when IE's Protected Mode is enabled.
        if (configParams.isIE) {
            vidyoConnector.SetCertificateAuthorityList({ certificateAuthorityList: "default" }).then(function() {
                console.log("SetCertificateAuthorityList success");
            }).catch(function() {
                console.error("SetCertificateAuthorityList failed");
            });
        }

        // Handle camera privacy and microphone privacy initial state
        if (configParams.cameraPrivacy === "1") {
           $("#cameraButton").click();
        }
        if (configParams.microphonePrivacy === "1") {
           $("#microphoneButton").click();
        }

        // Join the conference if the autoJoin URL parameter was enabled
        if (configParams.autoJoin === "1") {
          joinLeave();
        } else {
          // Handle the join in the toolbar button being clicked by the end user.
          $("#joinLeaveButton").one("click", joinLeave);
        }

        // Handle the camera privacy button, toggle between show and hide.
        $("#cameraButton").click(function() {
            // CameraPrivacy button clicked
            cameraPrivacy = !cameraPrivacy;
            vidyoConnector.SetCameraPrivacy({
                privacy: cameraPrivacy
            }).then(function() {
                if (cameraPrivacy) {
                    // Hide the local camera preview, which is in slot 0
                    $("#cameraButton").addClass("cameraOff").removeClass("cameraOn");
                    vidyoConnector.HideView({ viewId: "renderer0" }).then(function() {
                        console.log("HideView Success");
                    }).catch(function(e) {
                        console.log("HideView Failed");
                    });
                } else {
                    // Show the local camera preview, which is in slot 0
                    $("#cameraButton").addClass("cameraOn").removeClass("cameraOff");
                    vidyoConnector.AssignViewToLocalCamera({
                        viewId: "renderer0",
                        localCamera: selectedLocalCamera.camera,
                        displayCropped: false,
                        allowZoom: false
                    }).then(function() {
                        console.log("AssignViewToLocalCamera Success");
                        ShowRenderer(vidyoConnector, "renderer0");
                    }).catch(function(e) {
                        console.log("AssignViewToLocalCamera Failed");
                    });
                }
                console.log("SetCameraPrivacy Success");
            }).catch(function() {
                console.error("SetCameraPrivacy Failed");
            });
        });

        // Handle the microphone mute button, toggle between mute and unmute audio.
        $("#microphoneButton").click(function() {
            // MicrophonePrivacy button clicked
            microphonePrivacy = !microphonePrivacy;
            vidyoConnector.SetMicrophonePrivacy({
                privacy: microphonePrivacy
            }).then(function() {
                if (microphonePrivacy) {
                    $("#microphoneButton").addClass("microphoneOff").removeClass("microphoneOn");
                } else {
                    $("#microphoneButton").addClass("microphoneOn").removeClass("microphoneOff");
                }
                console.log("SetMicrophonePrivacy Success");
            }).catch(function() {
                console.error("SetMicrophonePrivacy Failed");
            });
        });

        function joinLeave() {
            // join or leave dependent on the joinLeaveButton, whether it
            // contains the class callStart or callEnd.
            if ($("#joinLeaveButton").hasClass("callStart")) {
                $("#connectionStatus").html("Connecting...");
                $("#joinLeaveButton").removeClass("callStart").addClass("callEnd");
                $('#joinLeaveButton').prop('title', 'Leave Conference');
                connectToConference(vidyoConnector, remoteCameras, configParams);
            } else {
                $("#connectionStatus").html("Disconnecting...");
                vidyoConnector.Disconnect().then(function() {
                    console.log("Disconnect Success");
                }).catch(function() {
                    console.error("Disconnect Failure");
                });
            }
            $("#joinLeaveButton").one("click", joinLeave);
        }

        $("#options").removeClass("optionsHide");
    }).catch(function(err) {
        console.error("CreateVidyoConnector Failed " + err);
    });
}

// Render a video in the div.
function ShowRenderer(vidyoConnector, divId) {
    var rndr = document.getElementById(divId);
    vidyoConnector.ShowViewAt({viewId: divId, x: rndr.offsetLeft, y: rndr.offsetTop, width: rndr.offsetWidth, height: rndr.offsetHeight});
}

// Find an open slot in the receive source slots (1 - 8)
function findOpenSlot() {
    // Scan through the renderer slots and look for an open slot.
    for (var i = 1; i < rendererSlots.length; ++i) {
        if (rendererSlots[i] === OPEN_REMOTE_SLOT)
            return i;
    }
    return 0;
}

// Render a remote camera to a particular slot
function renderToSlot(vidyoConnector, remoteCameras, participantId, slot) {
    // Render the remote camera to the slot.
    rendererSlots[slot] = participantId;
    remoteCameras[participantId].isRendered = true;
    vidyoConnector.AssignViewToRemoteCamera({
        viewId: "renderer" + (slot),
        remoteCamera: remoteCameras[participantId].camera,
        displayCropped: false,
        allowZoom: false
    }).then(function(retValue) {
        console.log("AssignViewToRemoteCamera " + participantId + " to slot " + slot + " = " + retValue);
        setTimeout(function(){
          ShowRenderer(vidyoConnector, "renderer" + (slot));
        }, 10000);
        // ShowRenderer(vidyoConnector, "renderer" + (slot));
        ++remoteSources.rendered;
    }).catch(function() {
        console.log("AssignViewToRemoteCamera Failed");
        rendererSlots[slot] = OPEN_REMOTE_SLOT;
        remoteCameras[participantId].isRendered = false;
    });
}

function registerEventListeners(vidyoConnector, cameras, microphones, speakers, selectedLocalCamera, remoteCameras, configParams) {
    // Map the "None" option (whose value is 0) in the camera, microphone, and speaker drop-down menus to null since
    // a null argument to SelectLocalCamera, SelectLocalMicrophone, and SelectLocalSpeaker releases the resource.
    cameras[0]     = null;
    microphones[0] = null;
    speakers[0]    = null;

    // Handle appearance and disappearance of camera devices in the system
    vidyoConnector.RegisterLocalCameraEventListener({
        onAdded: function(localCamera) {
            // New camera is available
            $("#cameras").append("<option value='" + window.btoa(localCamera.id) + "'>" + localCamera.name + "</option>");
            cameras[window.btoa(localCamera.id)] = localCamera;
        },
        onRemoved: function(localCamera) {
            // Existing camera became unavailable
            $("#cameras option[value='" + window.btoa(localCamera.id) + "']").remove();
            delete cameras[window.btoa(localCamera.id)];

            // If the removed camera was the selected camera, then hide it
            if(selectedLocalCamera.id === localCamera.id) {
                vidyoConnector.HideView({ viewId: "renderer0" }).then(function() {
                    console.log("HideView Success");
                }).catch(function(e) {
                    console.log("HideView Failed");
                });
            }
        },
        onSelected: function(localCamera) {
            // Camera was selected/unselected by you or automatically
            localCamera.SetMaxConstraint({width:1280, height:720, frameInterval:30})
            if(localCamera) {
                $("#cameras option[value='" + window.btoa(localCamera.id) + "']").prop('selected', true);
                selectedLocalCamera.id = localCamera.id;
                selectedLocalCamera.camera = localCamera;
                selectingCamera = true
                // Assign view to selected camera
                vidyoConnector.AssignViewToLocalCamera({
                    viewId: "renderer0",
                    localCamera: localCamera,
                    displayCropped: configParams.localCameraDisplayCropped,
                    allowZoom: false
                }).then(function() {
                    console.log("AssignViewToLocalCamera Success");
                    ShowRenderer(vidyoConnector, "renderer0");
                }).catch(function(e) {
                    console.log("AssignViewToLocalCamera Failed");
                });
            } else {
                selectedLocalCamera.id = 0;
                selectedLocalCamera.camera = null;
            }
        },
        onStateUpdated: function(localCamera, state) {
            // Camera state was updated
        }
    }).then(function() {
        console.log("RegisterLocalCameraEventListener Success");
    }).catch(function() {
        console.error("RegisterLocalCameraEventListener Failed");
    });

    // Handle appearance and disappearance of microphone devices in the system
    vidyoConnector.RegisterLocalMicrophoneEventListener({
        onAdded: function(localMicrophone) {
            // New microphone is available
            $("#microphones").append("<option value='" + window.btoa(localMicrophone.id) + "'>" + localMicrophone.name + "</option>");
            microphones[window.btoa(localMicrophone.id)] = localMicrophone;
        },
        onRemoved: function(localMicrophone) {
            // Existing microphone became unavailable
            $("#microphones option[value='" + window.btoa(localMicrophone.id) + "']").remove();
            delete microphones[window.btoa(localMicrophone.id)];
        },
        onSelected: function(localMicrophone) {
            // Microphone was selected/unselected by you or automatically
            if(localMicrophone)
                $("#microphones option[value='" + window.btoa(localMicrophone.id) + "']").prop('selected', true);
        },
        onStateUpdated: function(localMicrophone, state) {
            // Microphone state was updated
        }
    }).then(function() {
        console.log("RegisterLocalMicrophoneEventListener Success");
    }).catch(function() {
        console.error("RegisterLocalMicrophoneEventListener Failed");
    });

    // Handle appearance and disappearance of speaker devices in the system
    vidyoConnector.RegisterLocalSpeakerEventListener({
        onAdded: function(localSpeaker) {
            // New speaker is available
            $("#speakers").append("<option value='" + window.btoa(localSpeaker.id) + "'>" + localSpeaker.name + "</option>");
            speakers[window.btoa(localSpeaker.id)] = localSpeaker;
        },
        onRemoved: function(localSpeaker) {
            // Existing speaker became unavailable
            $("#speakers option[value='" + window.btoa(localSpeaker.id) + "']").remove();
            delete speakers[window.btoa(localSpeaker.id)];
        },
        onSelected: function(localSpeaker) {
            // Speaker was selected/unselected by you or automatically
            if(localSpeaker)
                $("#speakers option[value='" + window.btoa(localSpeaker.id) + "']").prop('selected', true);
        },
        onStateUpdated: function(localSpeaker, state) {
            // Speaker state was updated
        }
    }).then(function() {
        console.log("RegisterLocalSpeakerEventListener Success");
    }).catch(function() {
        console.error("RegisterLocalSpeakerEventListener Failed");
    });

    vidyoConnector.RegisterRemoteCameraEventListener({
        onAdded: function(camera, participant) {
            // Store the remote camera for this participant
            remoteCameras[participant.id] = {camera: camera, isRendered: false};
            ++remoteSources.count;
            canControl = camera.IsControllable();

            // Check if resource manager allows for an additional source to be rendered.
            if (remoteSources.rendered < remoteSources.max) {
                // If an open slot is found then assign it to the remote camera.
                var openSlot = findOpenSlot();
                if (openSlot > 0) {
                    renderToSlot(vidyoConnector, remoteCameras, participant.id, openSlot);
                }
            }
        },
        onRemoved: function(camera, participant) {
            console.log("RegisterRemoteCameraEventListener onRemoved participant.id : " + participant.id);
            delete remoteCameras[participant.id];
            --remoteSources.count;

            // Scan through the renderer slots and if this participant's camera
            // is being rendered in a slot, then clear the slot and hide the camera.
            for (var i = 1; i < rendererSlots.length; i++) {
                if (rendererSlots[i] === participant.id) {
                    rendererSlots[i] = OPEN_REMOTE_SLOT;
                    console.log("Slot found, calling HideView on renderer" + i);
                    vidyoConnector.HideView({ viewId: "renderer" + (i) }).then(function() {
                        console.log("HideView Success");
                        --remoteSources.rendered;

                        // If a remote camera is not rendered in a slot, replace it in the slot that was just cleared
                        for (var id in remoteCameras) {
                            if (!remoteCameras[id].isRendered) {
                                renderToSlot(vidyoConnector, remoteCameras, id, i);
                                break;
                            }
                        }
                    }).catch(function(e) {
                        console.log("HideView Failed");
                    });
                    break;
                }
            }
        },
        onStateUpdated: function(camera, participant, state) {
            // Camera state was updated
        }
    }).then(function() {
        console.log("RegisterRemoteCameraEventListener Success");
    }).catch(function() {
        console.error("RegisterRemoteCameraEventListener Failed");
    });

    vidyoConnector.RegisterParticipantEventListener({
        onJoined: function(participant) {
            getParticipantName(participant, function(name) {
                $("#participantStatus").html("" + name + " Joined");
                console.log("Participant onJoined: " + name);
            });
        },
        onLeft: function(participant) {
            getParticipantName(participant, function(name) {
                $("#participantStatus").html("" + name + " Left");
                console.log("Participant onLeft: " + name);
            });
        },
        onDynamicChanged: function(participants, cameras) {
            // Order of participants changed
        },
        onLoudestChanged: function(participant, audioOnly) {
            getParticipantName(participant, function(name) {
                $("#participantStatus").html("" + name + " Speaking");
            });

            // Consider switching loudest speaker tile if resource manager allows
            // for at least 1 remote source to be rendered.
            if (remoteSources.max > 0) {
                // Check if the loudest speaker is being rendered in one of the slots
                var found = false;
                for (var i = 1; i < rendererSlots.length; i++) {
                    if (rendererSlots[i] === participant.id) {
                        found = true;
                        break;
                    }
                }
                console.log("onLoudestChanged: loudest speaker in rendererSlots? " + found);

                // First check if the participant's camera has been added to the remoteCameras dictionary
                if (!(participant.id in remoteCameras)) {
                    console.log("Warning: loudest speaker participant does not have a camera in remoteCameras");
                }
                // If the loudest speaker is not being rendered in one of the slots then
                // hide the slot 1 remote camera and assign loudest speaker to slot 1.
                else if (!found) {
                    // Set the isRendered flag to false of the remote camera which is being hidden
                    remoteCameras[rendererSlots[1]].isRendered = false;

                    // Hiding the view first, before assigning to the loudes speaker's camera.
                    vidyoConnector.HideView({ viewId: "renderer1"}).then(function() {
                        console.log("HideView Success");
                        --remoteSources.rendered;

                        // Assign slot 1 to the the loudest speaker
                        renderToSlot(vidyoConnector, remoteCameras, participant.id, 1);
                    }).catch(function(e) {
                        console.log("HideView Failed, loudest speaker not assigned");
                    });
                }
            } else {
                console.log("Warning: not rendering loudest speaker because max remote sources is 0.");
            }
        }
    }).then(function() {
        console.log("RegisterParticipantEventListener Success");
    }).catch(function() {
        console.err("RegisterParticipantEventListener Failed");
    });
}

function handleDeviceChange(vidyoConnector, cameras, microphones, speakers) {
    // Hook up camera selector functions for each of the available cameras
    $("#cameras").change(function() {
        // Camera selected from the drop-down menu
        $("#cameras option:selected").each(function() {
            // Hide the view of the previously selected local camera
            vidyoConnector.HideView({ viewId: "renderer0" }).then(function() {
                console.log("HideView Success");
            }).catch(function(e) {
                console.log("HideView Failed");
            });

            // Select the newly selected local camera
            camera = cameras[$(this).val()];
            vidyoConnector.SelectLocalCamera({
                localCamera: camera
            }).then(function() {
                console.log("SelectCamera Success");
            }).catch(function() {
                console.error("SelectCamera Failed");
            });
        });
    });

    // Hook up microphone selector functions for each of the available microphones
    $("#microphones").change(function() {
        // Microphone selected from the drop-down menu
        $("#microphones option:selected").each(function() {
            microphone = microphones[$(this).val()];
            vidyoConnector.SelectLocalMicrophone({
                localMicrophone: microphone
            }).then(function() {
                console.log("SelectMicrophone Success");
            }).catch(function() {
                console.error("SelectMicrophone Failed");
            });
        });
    });

    // Hook up speaker selector functions for each of the available speakers
    $("#speakers").change(function() {
        // Speaker selected from the drop-down menu
        $("#speakers option:selected").each(function() {
            speaker = speakers[$(this).val()];
            vidyoConnector.SelectLocalSpeaker({
                localSpeaker: speaker
            }).then(function() {
                console.log("SelectSpeaker Success");
            }).catch(function() {
                console.error("SelectSpeaker Failed");
            });
        });
    });
}

function getParticipantName(participant, cb) {
    if (!participant) {
        cb("Undefined");
        return;
    }

    if (participant.name) {
        cb(participant.name);
        return;
    }

    participant.GetName().then(function(name) {
        cb(name);
    }).catch(function() {
        cb("GetNameFailed");
    });
}

function showRenderers(vidyoConnector) {
    ShowRenderer(vidyoConnector, "renderer0");
    ShowRenderer(vidyoConnector, "renderer1");
}

function updateRenderers(vidyoConnector, fullscreen) {
    if (fullscreen) {
        $("#options").addClass("optionsHide");
        $("#rendererContainer").css({'position':'absolute','top': '0px', 'right': '0px', 'left': '0px', 'bottom': '60px', 'z-index': '99'})
        $("#renderer0").addClass("renderer_pip").removeClass("rendererFullScreen");
			  $("#renderer1").removeClass("rendererHidden");
    } else {
        $("#options").removeClass("optionsHide");
        $("#rendererContainer").css({'position':'absolute','top': '0px', 'right': '0px', 'left': '350px', 'bottom': '60px', 'z-index': '99'})
        $("#renderer_preview").removeClass("renderer_pip").addClass("rendererFullScreen");
			  $("#renderer_remote").addClass("rendererHidden");
    }

    showRenderers(vidyoConnector);
}

// Attempt to connect to the conference
// We will also handle connection failures
// and network or server-initiated disconnects.
function connectToConference(vidyoConnector, remoteCameras, configParams) {
    // Abort the Connect call if resourceId is invalid. It cannot contain empty spaces or "@".
    if ( $("#resourceId").val().indexOf(" ") != -1 || $("#resourceId").val().indexOf("@") != -1) {
        console.error("Connect call aborted due to invalid Resource ID");
        connectorDisconnected(vidyoConnector, remoteCameras, "Disconnected", "");
        $("#error").html("<h3>Failed due to invalid Resource ID" + "</h3>");
        return;
    }

    // Clear messages
    $("#error").html("");
    $("#message").html("<h3 class='blink'>CONNECTING...</h3>");

    vidyoConnector.Connect({
        // Take input from options form
        host: $("#host").val(),
        token: $("#token").val(),
        displayName: $("#displayName").val(),
        resourceId: $("#resourceId").val(),

        // Define handlers for connection events.
        onSuccess: function() {
            // Connected
            console.log("vidyoConnector.Connect : onSuccess callback received");
            $("#connectionStatus").html("Connected");

            if (configParams.hideConfig != "1") {
                updateRenderers(vidyoConnector, true);
            }
            $("#message").html("");
            $("#renderer0").addClass("renderer_pip").removeClass("rendererFullScreen");
			      $("#renderer1").removeClass("rendererHidden");
        },
        onFailure: function(reason) {
            // Failed
            console.error("vidyoConnector.Connect : onFailure callback received");
            connectorDisconnected(vidyoConnector, remoteCameras, "Failed", "");
            $("#error").html("<h3>Call Failed: " + reason + "</h3>");
            $("#renderer0").removeClass("renderer_pip").addClass("rendererFullScreen");
            $("#renderer1").addClass("rendererHidden");
        },
        onDisconnected: function(reason) {
          $("#renderer0").removeClass("renderer_pip").addClass("rendererFullScreen");
          $("#renderer1").addClass("rendererHidden");
            // Disconnected
            console.log("vidyoConnector.Connect : onDisconnected callback received");
            connectorDisconnected(vidyoConnector, remoteCameras, "Disconnected", "Call Disconnected: " + reason);

            if (configParams.hideConfig != "1") {
               updateRenderers(vidyoConnector, false);
            }
        }
    }).then(function(status) {
        if (status) {
            console.log("Connect Success");
        } else {
            console.error("Connect Failed");
            connectorDisconnected(vidyoConnector, remoteCameras, "Failed", "");
            $("#error").html("<h3>Call Failed" + "</h3>");
        }
    }).catch(function() {
        console.error("Connect Failed");
        connectorDisconnected(vidyoConnector, remoteCameras, "Failed", "");
        $("#error").html("<h3>Call Failed" + "</h3>");
    });
}

// Connector either fails to connect or a disconnect completed, update UI
// elements and clear rendererSlots and remoteCameras.
function connectorDisconnected(vidyoConnector, remoteCameras, connectionStatus, message) {
    $("#connectionStatus").html(connectionStatus);
    $("#message").html(message);
    $("#participantStatus").html("");
    $("#joinLeaveButton").removeClass("callEnd").addClass("callStart");
    $('#joinLeaveButton').prop('title', 'Join Conference');

    // Clear rendererSlots and remoteCameras when not connected in case not cleared
    // in RegisterRemoteCameraEventListener onRemoved.
    for (var i = 1; i < rendererSlots.length; i++) {
        if (rendererSlots[i] != OPEN_REMOTE_SLOT) {
            rendererSlots[i] = OPEN_REMOTE_SLOT;
            console.log("Calling HideView on renderer" + i);
            vidyoConnector.HideView({ viewId: "renderer" + (i) }).then(function() {
                console.log("HideView Success");
            }).catch(function(e) {
                console.log("HideView Failed");
            });
        }
    }
    remoteCameras = {};
    remoteSources.max = 8;
    remoteSources.count = 0;
    remoteSources.rendered = 0;

    // Unregister for resource manager events
    vidyoConnector.UnregisterResourceManagerEventListener().then(function() {
        console.log("UnregisterResourceManagerEventListener Success");
    }).catch(function() {
        console.error("UnregisterResourceManagerEventListener Failed");
    });
}
