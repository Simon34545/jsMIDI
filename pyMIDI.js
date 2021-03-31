function addZeroes(num) {
	return Math.round(num) == num ? num + '.0' : String(num);
}

function download(filename, text) {
    var pom = document.createElement('a');
    pom.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    pom.setAttribute('download', filename);

    if (document.createEvent) {
        var event = document.createEvent('MouseEvents');
        event.initEvent('click', true, true);
        pom.dispatchEvent(event);
    }
    else {
        pom.click();
    }
}

class MidiTrackEvent {
	type = -1;
	channel = -1;
	
	typeDict = {0x8 : "Key Release",
				0x9 : "Key Press",
				0xA : "AfterTouch",
				0xB : "Pedal",
				0xC : "Instrument Change",
				0xD : "Global AfterTouch",
				0xE : "Pitch Bend"
				};
				
	typeBytes = {	0x8 : 2,
					0x9 : 2,
					0xA : 2,
					0xB : 2,
					0xC : 1,
					0xD : 1,
					0xE : 2
				};
};

class MidiMetaEvent {
	offset = -1;
	type = -1;
	length = -1;
	bytes = -1;

	constructor(offset,type,length,bytes) {
		this.offset = offset;
		this.type = type;
		this.length = length;
		this.bytes = bytes;
	};
};

class MidiFile {
	bytes = -1;
	headerLength = -1;
	headerOffset = 23;
	format = -1;
	tracks = -1;
	division = -1;
	divisionType = -1;
	itr = 0;
	runningStatus = -1;
	tempo = 120;
	
	midiRecord = "";
	midiSong = "";
	midiSheet = "";
	
	virtualPianoScale = "1!2@34$5%6^78*9(0qQwWeErtTyYuiIoOpPasSdDfgGhHjJklLzZxcCvVbBnm";
	
	deltaTimeStarted = false;
	deltaTime = 0;
	
	runningStatusSet = false;
	startSequence = [ 	[0x4D,0x54,0x68,0x64], //MThd
						[0x4D,0x54,0x72,0x6B], //MTrk
						[0xFF] //FF
					];
	startCounter = new Array(this.startSequence.length).fill(0);
	
	events = [];
	notes = [];
	
	typeDict = {0x00 : "Sequence Number",
				0x01 : "Text Event",
				0x02 : "Copyright Notice",
				0x03 : "Sequence/Track Name",
				0x04 : "Instrument Name",
				0x05 : "Lyric",
				0x06 : "Marker",
				0x07 : "Cue Point",
				0x20 : "MIDI Channel Prefix",
				0x2F : "End of Track",
				0x51 : "Set Tempo",
				0x54 : "SMTPE Offset",
				0x58 : "Time Signature",
				0x59 : "Key Signature",
				0x7F : "Sequencer-Specific Meta-event",
				0x21 : "Prefix Port",
				0x20 : "Prefix Channel",
				0x09 : "Other text format [0x09]",
				0x08 : "Other text format [0x08]",
				0x0A : "Other text format [0x0A]",
				0x0C : "Other text format [0x0C]"
				};

	
	constructor(filename) {
		this.bytes = filename;
		this.readEvents();
	};
	
	checkStartSequence = function() {
		for (var i = 0; i < this.startSequence.length; i++) {
			if (this.startSequence[i].length == this.startCounter[i]) {
				return true;
			};
		};
		return false;
	};
	
	skip = function(i) {
		this.itr += i;
	};
	
	readLength = function() {
		var contFlag = true;
		var length = 0;
		while (contFlag) {
			if ((this.bytes[this.itr] & 0x80) >> 7 == 0x1) {
				length = (length << 7) + (this.bytes[this.itr] & 0x7F);
			} else {
				contFlag = false;
				length = (length << 7) + (this.bytes[this.itr] & 0x7F);
			}
			this.itr += 1;
		}
		return length;
	};
	
	readMTrk = function() {
		var length = this.getInt(4);
		this.log("MTrk len",length);
		this.readMidiTrackEvent(length);
	};
	
	readMThd = function() {
		this.headerLength = this.getInt(4);
		this.log("HeaderLength",this.headerLength);
		this.format = this.getInt(2);
		this.tracks = this.getInt(2);
		var div = this.getInt(2);
		this.divisionType = (div & 0x8000) >> 16;
		this.division = div & 0x7FFF;
		this.log(`Format ${this.format}\nTracks ${this.tracks}\nDivisionType ${this.divisionType}\nDivision ${this.division}`);
	};
	
	readText = function(length) {
		var s = "";
		var start = this.itr;
		while (this.itr < length + start) {
			s += String.fromCharCode(this.bytes[this.itr]);
			this.itr += 1;
		}
		return s;
	}
	
	readMidiMetaEvent = function(deltaT) {
		var type = this.bytes[this.itr];
		this.itr += 1;
		var length = this.readLength();
		var eventName;
		
		try {
			eventName = this.typeDict[type];
		} catch {
			eventName = "Unknown Event " + toString(type);
		}
		
		this.log("MIDIMETAEVENT",eventName,"LENGTH",length,"DT",deltaT);
		if (type == 0x2F) {
			this.log("END TRACK");
			this.itr += 2;
			return false;
		} else if ([0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08,0x09,0x0A,0x0C].includes(type)) {
			this.log("\t",this.readText(length));
		} else if (type == 0x51) {
			this.tempo = this.round(this.getInt(3) * 0.00024);
			this.log("\tNew tempo is",this.tempo);
		} else {
			this.itr+= length;
		}
		return true;
	}
		
	readMidiTrackEvent = function(length) {
		this.log("TRACKEVENT");
		this.deltaTime = 0;
		var start = this.itr;
		var continueFlag = true;
		while (length > this.itr - start && continueFlag) {
			var deltaT = this.readLength();
			this.deltaTime += deltaT;
			if (this.bytes[this.itr] == 0xFF) {
				this.itr += 1;
				continueFlag = this.readMidiMetaEvent(deltaT);
			} else if (this.bytes[this.itr] >= 0xF0 && this.bytes[this.itr] <= 0xF7) {
				this.runningStatusSet = false;
				this.runningStatus = -1;
				this.log("RUNNING STATUS SET:","CLEARED");
			} else {
				this.readVoiceEvent(deltaT);
			}
		}
		this.log("End of MTrk event, jumping from",this.itr,"to",start+length);
		this.itr = start + length;
	}
				
	readVoiceEvent = function(deltaT) {
		var type;
		var channel;
		
		if (this.bytes[this.itr] < 0x80 && this.runningStatusSet) {
			type = this.runningStatus;
			channel = type & 0x0F;
		} else {
			type = this.bytes[this.itr];
			channel = this.bytes[this.itr] & 0x0F;
			if (type >= 0x80 && type <= 0xF7) {
				this.log("RUNNING STATUS SET:","0x" + type.toString(16));
				this.runningStatus = type;
				this.runningStatusSet = true;
			}
			this.itr += 1;
		}
		
		var key;
		var velocity;
		var map;
		
		if (type >> 4 == 0x9) {
			key = this.bytes[this.itr];
			this.itr += 1;
			velocity = this.bytes[this.itr];
			this.itr += 1;
			
			map = key - 23 - 12 - 1;
			while (map >= this.virtualPianoScale.length) {
				map -= 12;
			}
			while (map < 0) {
				map += 12;
			}
			
			// 
			this.log(addZeroes(this.deltaTime/this.division),this.virtualPianoScale[map]);
			// 
			if (velocity > 0) {
				this.notes.push([(this.deltaTime/this.division),this.virtualPianoScale[map]]);
			}
				
		} else if (!([0x8,0x9,0xA,0xB,0xD,0xE].includes(type >> 4))) {
			this.log("VoiceEvent","0x" + type.toString(16),"0x" + this.bytes[this.itr].toString(16),"DT",deltaT);
			this.itr +=1;
		} else {
			this.log("VoiceEvent","0x" + type.toString(16),"0x" + this.bytes[this.itr].toString(16),"0x" + this.bytes[this.itr+1].toString(16),"DT",deltaT);
			this.itr+=2;
		}
	}
	
	readEvents = function() {
		while (this.itr + 1 < this.bytes.length) {
			//Reset counters to 0
			for (var i = 0; i < this.startCounter.length; i++) {
				this.startCounter[i] = 0;
			}
			
			//Get to next event / MThd / MTrk
			while (this.itr + 1 < this.bytes.length && !this.checkStartSequence()) {
				for (i = 0; i < this.startSequence.length; i++) {
					if (this.bytes[this.itr] == this.startSequence[i][this.startCounter[i]]) {
						this.startCounter[i] += 1;
					} else {
						this.startCounter[i] = 0;
					}
				}	
				if (this.itr + 1 < this.bytes.length) {
					this.itr += 1;
				}
				if (this.startCounter[0] == 4) {
					this.readMThd();
				} else if (this.startCounter[1] == 4) {
					this.readMTrk();
				}
			}
		}
	}
	
	log = function(...arg) {
		for (var s = 0; s < arg.length; s++) {
			try {
				this.midiRecord += arg[s] + " ";
			} catch {
				this.midiRecord += "[?] ";
			}
		}
		this.midiRecord += "\n";
	}
	
	getInt = function(i) {
		var k = 0;
		var m = this.bytes.slice(this.itr, this.itr+i);
		for (var l = 0; l < m.length; l++) {
			var n = m[l];
			k = (k << 8) + n;
		}
		this.itr += i;
		return k;
	}
	
	round = function(i) {
		var up = parseInt(i+1);
		var down = parseInt(i-1);
		if (up - i < i - down) {
			return up;
		} else {
			return down;
		}
	}
}

document.getElementById('file').addEventListener('change', function(e) {
	var fileT = e.target.files[0];
	if (!fileT) {
		return;
	}
	var files = e.target.files;
	for (var j = 0; j < e.target.files.length; j++) {
		var file = e.target.files[j];
	if (!file) {
		continue;
	}
	var reader = new FileReader();
	reader.onload = function(e) {
		var results = [];
		var contents = e.target.result;
		var array = new Uint8Array(contents);
		
		for (var i = 0; i < array.length; i++) {
			results.push(array[i]);
		}
		try {
			// start
			document.body.appendChild((function() { document.body.appendChild(document.createElement('br')); var a = document.createElement('tt'); a.innerText = "Processing " + file.name; return a; } )());
			
			
			
			midi = new MidiFile(results);
			midi.midiSong += "tempo= " + midi.tempo + "\n";
			midi.notes = midi.notes.sort(function(a,b){return a[0]-b[0];}).map(function(e){return[addZeroes(e[0]),e[1]]});
			
			//Combine seperate lines with equal timings
			var i = 1
			while (i < midi.notes.length) {
				if (midi.notes[i-1][0] == midi.notes[i][0]) {
					midi.notes[i][1] += midi.notes[i-1][1];
					midi.notes.splice(i-1, 1);
				} else {
					i += 1;
				}
			}
			
			//Remove duplicate notes on same line
			for (var q = 0; q < midi.notes.length; q++) {
				var letterDict = {};
				var newline = "";
				for (var i = 0; i < midi.notes[q][1].length; i++) {
					if (!(midi.notes[q][1][i] in letterDict)) {
						newline += midi.notes[q][1][i];
						letterDict[midi.notes[q][1][i]] = true;
					}
				}
				midi.notes[q][1] = newline;
			}
			
			//Write notes to song.txt
			for (var i = 0; i < midi.notes.length; i++) {
				var l = midi.notes[i]
				midi.midiSong += l[0] + " " + l[1] + "\n";
			}
			
			//Make a more traditional virtualPiano sheet music made for reading by people
			var noteCount = 0;
			for (var i = 0; i < midi.notes.length; i++) {
				var l = midi.notes[i];
					
				var note;
				if (l[1].length > 1) {
					note = "["+l[1]+"]";
				} else {
					note = l[1];
				}
				noteCount += 1;
				midi.midiSheet += note.padStart(7, " ") + " ";
				if(noteCount % 8 == 0) {
					midi.midiSheet += "\n";
				}
			}
				
						
				
			//end
			document.body.appendChild(document.createElement('br'));
			
			var validResponses = {
				"a": function() {
					document.body.appendChild((function() { document.body.appendChild(document.createElement('br')); var a = document.createElement('tt'); a.innerText = midi.midiSong; return a; } )());
					return true;
				},
				"b": function() {
					download("song.txt", midi.midiSong);
					return false;
				},
				"c": function() {
					document.body.appendChild((function() { document.body.appendChild(document.createElement('br')); var a = document.createElement('tt'); a.innerText = midi.midiSheet; return a; } )());
					return true;
				},
				"d": function() {
					download("sheetConversion.txt", midi.midiSheet);
					return false;
				},
				"e": function() {
					document.body.appendChild((function() { document.body.appendChild(document.createElement('br')); var a = document.createElement('tt'); a.innerText = midi.midiRecord; return a; } )());
					return true;
				},
				"f": function() {
					download("midiRecord.txt", midi.midiRecord);
					return false;
				},
				"g": function() {
					location.reload();
					return true;
				},
			};
			
			while (true) {
				alert("The file has finished processing.\nNote:\nsong.txt = the MIDI song ready for my/Stereo101's autoplayer\nsheetConversion.txt = the MIDI song as sheet music that can be easily read\nmidiRecord.txt = a log file of the conversion process");
				var response = prompt('Please choose from:\nA = View song.txt\nB = Download song.txt\nC = View sheetConversion.txt\nD = Download sheetConversion.txt\nE = View midiRecord.txt\nF = Download midiRecord.txt\nG = Convert another MIDI file');
				if (response == null) { continue; }
				response = response.toLowerCase().substring(0, 1);
				if (response in validResponses) {
					if (validResponses[response]()) {
						break;
					}
				} else {
					alert("Invalid response!");
				}
			}
		} catch (error) {
			console.error(error);
			document.body.appendChild((function() { document.body.appendChild(document.createElement('br')); var a = document.createElement('pre'); a.innerText = error.stack; a.style.color = "#cc0000"; return a; } )());
			document.body.appendChild((function() { document.body.appendChild(document.createElement('br')); var a = document.createElement('tt'); a.innerText = "An error has occured. Please report this to ."; return a; } )());
		}
	};
	reader.readAsArrayBuffer(file);
	}
}, {once: true});