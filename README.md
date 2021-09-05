<!DOCTYPE html>
<html>
  <head>
	<title>My Online Piano</title>
	
	<style>
		label{display:inline-block;width:100px;height:25px;}
		select{display:inline-block;width:120px;height:25px;}
	</style>
	
	<script src="audiounit.js"></script>
	<script type="text/javascript">	
	let keyboard_mode = 1;		// 0: alphabetic order, 1: qwerty layout, 2: qwerty angular (qazwsx...)	
	let shift_mode = 47;		// 470 => Major-R
	let last_focus_window = null;
	let last_num_key = 0;
	let last_mouse_note = 0;
	let mouse_is_down = 0;
	
	function on_mouse_event(event, event_type){	//0: move, 1: down, 2: up
		if ( event_type == 2 ){
			mouse_is_down = 0;
			return;
		}
		if ( event_type == 1 )mouse_is_down = 1;
		if ( mouse_is_down != 1 )return;
		
		const r2 = document.getElementById('my_canvas').getBoundingClientRect();
		const x2 = ( event.clientX - r2.left), y2 = ( event.clientY - r2.top );
		let note_no = Math.floor((y2 * 4)/(r2.bottom - r2.top)) * 12 + Math.floor(( x2 * 12 )/(r2.right - r2.left));
		note_no -= 12;
		if ( note_no == last_mouse_note )return;
		audiounit_play_note([parseInt(440 * Math.pow(2.0, note_no/12.0))]);
		last_mouse_note = note_no;		
	}
	
	const alphabetic_str = "abcdefghijklmnopqrstuvwxyz,./;'\\[]";
	const qwerty_str = "zxcvbnm,./asdfghjkl;'\\qwertyuiop[]";
	const qwerty_str_zaq = "zaqxswcdevfrbgtnhymju,ki.lo/;p\\'[]";
	
    window.onload = function() {
        document.addEventListener('mousedown',function(event)
        {
			if ( last_focus_window == document.getElementById('my_canvas')){
				on_mouse_event(event, 1);
			}
			
            last_focus_window = event.target;
        }, false);
        
		document.addEventListener('mousemove', function(event){
			on_mouse_event(event, 0);
		}, false);
		
		document.addEventListener('mouseup', function(event){
			on_mouse_event(event, 2);
		}, false);
		
        document.addEventListener('keydown', function(event) 
        {
            if(last_focus_window == document.getElementById('my_canvas')) {
				let str = event.key;
				if ( str.length > 1 )return;
				
				let c = str.charCodeAt(0);
				if ( c >= 48 && c <= 57 ){
					last_num_key = parseInt(c - 48);
					document.getElementById('id_shift_mode').selectedIndex = last_num_key;
					handle_menu_event(4);
					return;
				}
				
				let use_shift = 0;
				if ( c >= 65 && c <= 92 ){
					use_shift = 1;
					c += 32;
				}
				
				let note_no = 0;
				if ( keyboard_mode == 1 )note_no = qwerty_str.indexOf(str.toLowerCase().charAt(0));
				else if ( keyboard_mode == 2 )note_no = qwerty_str_zaq.indexOf(str.toLowerCase().charAt(0));
				else note_no = alphabetic_str.indexOf(str.toLowerCase().charAt(0));
				
				note_no = parseInt(note_no - 24);
				let base_freq = 440;
				
				if ( use_shift != 0 && shift_mode >= 4 ){
					let ff = [], pp = 0;
					ff[pp++] = parseInt(base_freq * Math.pow(2.0, note_no/12.0));
					let ss = ff[pp-1] + ', ';
					let tmp = shift_mode;
					
					for ( var i = 0; i < 4 && tmp > 0; i++ ){
						let tmp2 = tmp % 10;
						tmp = parseInt(tmp/10);
						
						if ( tmp2 == 0 )ff[pp++] = parseInt(base_freq * Math.pow(2.0, parseFloat( note_no - 8 )/12.0));
						else ff[pp++] = parseInt(base_freq * Math.pow(2.0, parseFloat(note_no + tmp2)/12.0));
						
						ss += (ff[pp-1] + ', ');
					}
					console.log('playing freqs = ' + ss);
					audiounit_play_note(ff);
				}else{					
					let freq = parseInt(base_freq * Math.pow(2.0, note_no / 12.0));
					console.log('playing freq = ' + freq);
					audiounit_play_note([freq]);				
				}
            }
        }, false);
    }	

	function handle_menu_event(n){
		if ( n == 0 ){	// Start button
			let freq = parseInt(document.getElementById('id_frequency').value);
			let ch_cnt = parseInt(document.getElementById('id_channel_count').value);
			audiounit_init(freq, ch_cnt);
			return;
		}
		
		if ( n == 1 ){	// Thread mode
			let s = document.getElementById('id_thread_mode').value.toLowerCase();
			if ( s.startsWith('thread'))audiounit_set_thread_mode(1);
			else if ( s.startsWith('event'))audiounit_set_thread_mode(2);
			else audiounit_set_thread_mode(0);
			return;	
		}
		
		if ( n == 2 ){
			let n1 = parseInt(document.getElementById('id_npm').value);
			let n2 = parseInt(document.getElementById('id_channel_count').value);
			
			audiounit_set_note_settings(parseFloat(60.0/n1), parseInt(n2));
			return;
		}
		
		if ( n == 3 ){
			let s = document.getElementById('id_keyboard_mode').value.toLowerCase();
			if ( s.startsWith('qwerty zaq'))keyboard_mode = 2;
			else if ( s.startsWith('qwerty'))keyboard_mode = 1;
			else keyboard_mode = 0;			
			return;
		}
		
		if ( n == 4 ){
			let s = document.getElementById('id_shift_mode').value.toLowerCase();
			if ( s.startsWith("halfnote"))shift_mode = 1;
			else if ( s.startsWith("double"))shift_mode = 2;
			else if ( s.startsWith("major-r"))shift_mode = 470;
			else if ( s.startsWith("major"))shift_mode = 47;
			else if ( s.startsWith("minor-r"))shift_mode = 370;
			else if ( s.startsWith("minor"))shift_mode = 37;
			else if ( s.startsWith("r-r"))shift_mode = 0;
			
			console.log(s);
			return;
		}
	}
	</script>

	
  </head>

  <body>	
	<canvas id="my_canvas" width="640px" height="320px" onkeydown="on_canvas_key(event);"></canvas><br/>  	

	<label>Sample rate</label><select id='id_frequency' onchange='alert("This will take effect after you start again.");'><option>16000/s</option><option>44000/s</option><option>48000/s</option><option>8000/s</option></select>
	<input type="submit" value="Start" onclick="handle_menu_event(0);"/><br/><br/>
	
	<b><u>Piano settings</u></b><br/>
	<label>Shift key</label><select id='id_shift_mode' onchange="handle_menu_event(4);"><option>Halfnote</option><option>Double note</option><option>Major</option><option>Minor</option><option>Major-R</option><option>Minor-R</option><option>R-R</option></select><br/>
	<label>Out channels</label><select id='id_channel_count' onchange="handle_menu_event(2);"><option>1 channel</option><option>2 channels</option></select><br/>
	<label>Play mode</label><select id='id_thread_mode' onchange="handle_menu_event(1);"><option>Play as you type</option><option>Thread based</option><option>Event based</option></select><br/>
	<label>Key2Note</label><select id='id_keyboard_mode' onchange='handle_menu_event(3);'><option>Qwerty</option><option>Qwerty ZAQ</option><option>Alphabetic</option></select><br/>
	<label>Note frequency</label><select id='id_npm' onchange="handle_menu_event(2);"><option>60 npm</option><option>90 npm</option><option>120 npm</option></select><br/>
	
	<br/>
  </body>
</html>
